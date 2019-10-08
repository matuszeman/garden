/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import chalk from "chalk"
import { BaseTask, TaskParams, TaskType } from "./base"
import { ProviderConfig, Provider, getAllProviderDependencyNames, providerFromConfig } from "../config/provider"
import { resolveTemplateStrings } from "../template-string"
import { ConfigurationError, PluginError, RuntimeError } from "../exceptions"
import { keyBy, omit, flatten, uniq } from "lodash"
import { TaskResults } from "../task-graph"
import { ProviderConfigContext } from "../config/config-context"
import { ModuleConfig } from "../config/module"
import { GardenPlugin, PluginMap } from "../types/plugin/plugin"
import { validateWithPath, joi } from "../config/common"
import Bluebird from "bluebird"
import { defaultEnvironmentStatus } from "../types/plugin/provider/getEnvironmentStatus"

interface Params extends TaskParams {
  plugin: GardenPlugin
  config: ProviderConfig
  forceInit: boolean
}

/**
 * Resolves the configuration for the specified provider.
 */
export class ResolveProviderTask extends BaseTask {
  type: TaskType = "resolve-provider"

  private config: ProviderConfig
  private plugin: GardenPlugin
  private forceInit: boolean

  constructor(params: Params) {
    super(params)
    this.config = params.config
    this.plugin = params.plugin
    this.forceInit = params.forceInit
  }

  getName() {
    return this.config.name
  }

  getDescription() {
    return `resolving provider ${this.getName()}`
  }

  async getDependencies() {
    const depNames = await getAllProviderDependencyNames(this.plugin, this.config)

    const rawProviderConfigs = this.garden.getRawProviderConfigs()
    const plugins = keyBy(await this.garden.getPlugins(), "name")

    return flatten(await Bluebird.map(depNames, async (depName) => {
      // Match against a provider if its name matches directly, or it inherits from a base named `depName`
      const matched = rawProviderConfigs.filter(c =>
        c.name === depName || getPluginBaseNames(c.name, plugins).includes(depName),
      )

      if (matched.length === 0) {
        throw new ConfigurationError(
          `Missing provider dependency '${depName}' in configuration for provider '${this.config.name}'. ` +
          `Are you missing a provider configuration?`,
          { config: this.config, missingProviderName: depName },
        )
      }

      return matched.map(config => {
        const plugin = plugins[depName]

        return new ResolveProviderTask({
          garden: this.garden,
          plugin,
          config,
          log: this.log,
          version: this.version,
          forceInit: this.forceInit,
        })
      })
    }))
  }

  async process(dependencyResults: TaskResults) {
    const resolvedProviders: Provider[] = Object.values(dependencyResults).map(result => result && result.output)

    const context = new ProviderConfigContext(this.garden.environmentName, this.garden.projectName, resolvedProviders)

    this.log.silly(`Resolving template strings for plugin ${this.config.name}`)
    let resolvedConfig = await resolveTemplateStrings(this.config, context)

    const providerName = resolvedConfig.name

    this.log.silly(`Validating ${providerName} config`)

    const validateConfig = (config: ProviderConfig) => {
      return <ProviderConfig>validateWithPath({
        config: omit(config, "path"),
        schema: this.plugin.configSchema || joi.object(),
        path: this.garden.projectRoot,
        projectRoot: this.garden.projectRoot,
        configType: "provider configuration",
        ErrorClass: ConfigurationError,
      })
    }

    resolvedConfig = validateConfig(resolvedConfig)
    resolvedConfig.path = this.garden.projectRoot

    const configureHandler = (this.plugin.handlers || {}).configureProvider

    let moduleConfigs: ModuleConfig[] = []

    if (configureHandler) {
      this.log.silly(`Calling configureProvider on ${providerName}`)

      const configureOutput = await configureHandler({
        log: this.log,
        config: resolvedConfig,
        configStore: this.garden.configStore,
        projectName: this.garden.projectName,
        projectRoot: this.garden.projectRoot,
        dependencies: resolvedProviders,
      })

      this.log.silly(`Validating ${providerName} config returned from configureProvider handler`)
      resolvedConfig = validateConfig(configureOutput.config)
      resolvedConfig.path = this.garden.projectRoot

      if (configureOutput.moduleConfigs) {
        moduleConfigs = configureOutput.moduleConfigs
      }
    }

    // Validating the output config against the base plugins. This is important to make sure base handlers are
    // compatible with the config.
    const plugins = await this.garden.getPlugins()
    const pluginsByName = keyBy(plugins, "name")
    const bases = getPluginBases(this.plugin, pluginsByName)

    for (const base of bases) {
      if (!base.configSchema) {
        continue
      }

      this.log.silly(`Validating '${providerName}' config against '${base.name}' schema`)

      resolvedConfig = <ProviderConfig>validateWithPath({
        config: omit(resolvedConfig, "path"),
        schema: base.configSchema,
        path: this.garden.projectRoot,
        projectRoot: this.garden.projectRoot,
        configType: `provider configuration (base schema from '${base.name}' plugin)`,
        ErrorClass: ConfigurationError,
      })
    }

    this.log.silly(`Ensuring ${providerName} provider is ready`)

    const tmpProvider = providerFromConfig(resolvedConfig, resolvedProviders, moduleConfigs, defaultEnvironmentStatus)
    const status = await this.ensurePrepared(tmpProvider)

    return providerFromConfig(resolvedConfig, resolvedProviders, moduleConfigs, status)
  }

  private async ensurePrepared(tmpProvider: Provider) {
    const pluginName = tmpProvider.name
    const actions = await this.garden.getActionHelper()
    const ctx = this.garden.getPluginContext(tmpProvider)

    this.log.silly(`Getting status for ${pluginName}`)

    const handler = await actions.getActionHandler({
      actionType: "getEnvironmentStatus",
      pluginName,
      defaultHandler: async () => defaultEnvironmentStatus,
    })

    let status = await handler({ ctx, log: this.log })

    this.log.silly(`${pluginName} status: ${status.ready ? "ready" : "not ready"}`)

    if (this.forceInit || !status.ready) {
      // Deliberately setting the text on the parent log here
      this.log.setState(`Preparing environment...`)

      const envLogEntry = this.log.info({
        status: "active",
        section: pluginName,
        msg: "Configuring...",
      })

      const prepareHandler = await actions.getActionHandler({
        actionType: "prepareEnvironment",
        pluginName,
        defaultHandler: async () => ({ status }),
      })
      const result = await prepareHandler({ ctx, log: this.log, force: this.forceInit, status })

      status = result.status

      envLogEntry.setSuccess({ msg: chalk.green("Ready"), append: true })
    }

    if (!status.ready) {
      throw new PluginError(
        `Provider ${pluginName} reports status as not ready and could not prepare the configured environment.`,
        { name: pluginName, status, provider: tmpProvider },
      )
    }

    return status
  }
}

/**
 * Recursively resolves all the bases for the given plugin.
 */
export function getPluginBases(plugin: GardenPlugin, loadedPlugins: PluginMap): GardenPlugin[] {
  if (!plugin.base) {
    return []
  }

  const base = loadedPlugins[plugin.base]

  if (!base) {
    throw new RuntimeError(`Unable to find base plugin '${plugin.base}' for plugin '${plugin.name}'`, { plugin })
  }

  return [base, ...getPluginBases(base, loadedPlugins)]
}

/**
 * Recursively resolves all the base names for the given plugin.
 */
export function getPluginBaseNames(name: string, loadedPlugins: PluginMap) {
  return getPluginBases(loadedPlugins[name], loadedPlugins).map(p => p.name)
}

/**
 * Recursively get all declared dependencies for the given plugin,
 * i.e. direct dependencies, and dependencies of those dependencies etc.
 */
export function getPluginDependencies(plugin: GardenPlugin, loadedPlugins: PluginMap): GardenPlugin[] {
  return uniq(flatten((plugin.dependencies || []).map(depName => {
    const depPlugin = loadedPlugins[depName]
    if (!depPlugin) {
      throw new RuntimeError(`Unable to find dependency '${depName} for plugin '${plugin.name}'`, { plugin })
    }
    return [depPlugin, ...getPluginDependencies(depPlugin, loadedPlugins)]
  })))
}
