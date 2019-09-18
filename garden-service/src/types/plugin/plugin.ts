/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import Joi = require("@hapi/joi")
import { BuildModuleParams, BuildResult, build } from "./module/build"
import { BuildStatus, GetBuildStatusParams, getBuildStatus } from "./module/getBuildStatus"
import { CleanupEnvironmentParams, CleanupEnvironmentResult, cleanupEnvironment } from "./provider/cleanupEnvironment"
import { ConfigureModuleParams, ConfigureModuleResult, configure } from "./module/configure"
import { ConfigureProviderParams, ConfigureProviderResult, configureProvider } from "./provider/configureProvider"
import { DeleteSecretParams, DeleteSecretResult, deleteSecret } from "./provider/deleteSecret"
import { DeleteServiceParams, deleteService } from "./service/deleteService"
import { DeployServiceParams, deployService } from "./service/deployService"
import { DescribeModuleTypeParams, ModuleTypeDescription, describeType } from "./module/describeType"
import { EnvironmentStatus, GetEnvironmentStatusParams, getEnvironmentStatus } from "./provider/getEnvironmentStatus"
import { ExecInServiceParams, ExecInServiceResult, execInService } from "./service/execInService"
import { GetSecretParams, GetSecretResult, getSecret } from "./provider/getSecret"
import { GetServiceLogsParams, getServiceLogs } from "./service/getServiceLogs"
import { GetServiceStatusParams, getServiceStatus } from "./service/getServiceStatus"
import { GetTaskResultParams, getTaskResult } from "./task/getTaskResult"
import { GetTestResultParams, getTestResult, TestResult } from "./module/getTestResult"
import { HotReloadServiceParams, HotReloadServiceResult, hotReloadService } from "./service/hotReloadService"
import { PrepareEnvironmentParams, PrepareEnvironmentResult, prepareEnvironment } from "./provider/prepareEnvironment"
import { PublishModuleParams, PublishResult, publishModule } from "./module/publishModule"
import { RunModuleParams, runModule } from "./module/runModule"
import { RunServiceParams, runService } from "./service/runService"
import { RunTaskParams, RunTaskResult, runTask } from "./task/runTask"
import { SetSecretParams, SetSecretResult, setSecret } from "./provider/setSecret"
import { TestModuleParams, testModule } from "./module/testModule"
import { joiArray, joiIdentifier, joiIdentifierMap, joi } from "../../config/common"

import { LogNode } from "../../logger/log-node"
import { Module } from "../module"
import { RunResult } from "./base"
import { ServiceStatus } from "../service"
import { mapValues } from "lodash"
import { getDebugInfo, DebugInfo, GetDebugInfoParams } from "./provider/getDebugInfo"
import { deline } from "../../util/string"
import { pluginCommandSchema, PluginCommand } from "./command"
import { getPortForward, GetPortForwardParams, GetPortForwardResult } from "./service/getPortForward"
import { StopPortForwardParams, stopPortForward } from "./service/stopPortForward"

export type ServiceActions<T extends Module = Module> = {
  [P in keyof ServiceActionParams<T>]: (params: ServiceActionParams<T>[P]) => ServiceActionOutputs[P]
}

export type TaskActions<T extends Module = Module> = {
  [P in keyof TaskActionParams<T>]: (params: TaskActionParams<T>[P]) => TaskActionOutputs[P]
}

export type ModuleActions<T extends Module = Module> = {
  [P in keyof ModuleActionParams<T>]: (params: ModuleActionParams<T>[P]) => ModuleActionOutputs[P]
}

export type ModuleAndRuntimeActions<T extends Module = Module> = ModuleActions<T> & ServiceActions<T> & TaskActions<T>

export type PluginActionName = keyof PluginActions
export type ServiceActionName = keyof ServiceActions
export type TaskActionName = keyof TaskActions
export type ModuleActionName = keyof ModuleActions

export interface PluginActionDescription {
  description: string
  // TODO: specify the schemas using primitives and not Joi objects
  paramsSchema: Joi.Schema
  resultSchema: Joi.Schema
}

export interface PluginActionParams {
  configureProvider: ConfigureProviderParams

  getEnvironmentStatus: GetEnvironmentStatusParams
  prepareEnvironment: PrepareEnvironmentParams
  cleanupEnvironment: CleanupEnvironmentParams

  getSecret: GetSecretParams
  setSecret: SetSecretParams
  deleteSecret: DeleteSecretParams

  getDebugInfo: GetDebugInfoParams
}

export interface PluginActionOutputs {
  configureProvider: Promise<ConfigureProviderResult>

  getEnvironmentStatus: Promise<EnvironmentStatus>
  prepareEnvironment: Promise<PrepareEnvironmentResult>
  cleanupEnvironment: Promise<CleanupEnvironmentResult>

  getSecret: Promise<GetSecretResult>
  setSecret: Promise<SetSecretResult>
  deleteSecret: Promise<DeleteSecretResult>

  getDebugInfo: Promise<DebugInfo>
}

export type PluginActions = {
  [P in keyof PluginActionParams]: (params: PluginActionParams[P]) => PluginActionOutputs[P]
}

export const pluginActionDescriptions: {
  [P in PluginActionName]: PluginActionDescription
} = {
  configureProvider,
  getEnvironmentStatus,
  prepareEnvironment,
  cleanupEnvironment,

  getSecret,
  setSecret,
  deleteSecret,

  getDebugInfo,
}

export interface ServiceActionParams<T extends Module = Module> {
  deployService: DeployServiceParams<T>
  deleteService: DeleteServiceParams<T>
  execInService: ExecInServiceParams<T>
  getPortForward: GetPortForwardParams<T>
  getServiceLogs: GetServiceLogsParams<T>
  getServiceStatus: GetServiceStatusParams<T>
  hotReloadService: HotReloadServiceParams<T>
  runService: RunServiceParams<T>
  stopPortForward: StopPortForwardParams<T>
}

export interface ServiceActionOutputs {
  deployService: Promise<ServiceStatus>
  deleteService: Promise<ServiceStatus>
  execInService: Promise<ExecInServiceResult>
  getPortForward: Promise<GetPortForwardResult>
  getServiceLogs: Promise<{}>
  getServiceStatus: Promise<ServiceStatus>
  hotReloadService: Promise<HotReloadServiceResult>
  runService: Promise<RunResult>
  stopPortForward: Promise<{}>
}

export const serviceActionDescriptions: {
  [P in ServiceActionName]: PluginActionDescription
} = {
  deployService,
  deleteService,
  execInService,
  getPortForward,
  getServiceLogs,
  getServiceStatus,
  hotReloadService,
  runService,
  stopPortForward,
}

export interface TaskActionParams<T extends Module = Module> {
  getTaskResult: GetTaskResultParams<T>
  runTask: RunTaskParams<T>
}

export interface TaskActionOutputs {
  runTask: Promise<RunTaskResult>
  getTaskResult: Promise<RunTaskResult | null>
}

export const taskActionDescriptions: {
  [P in TaskActionName]: PluginActionDescription
} = {
  getTaskResult,
  runTask,
}

export interface ModuleActionParams<T extends Module = Module> {
  describeType: DescribeModuleTypeParams
  configure: ConfigureModuleParams<T>
  getBuildStatus: GetBuildStatusParams<T>
  build: BuildModuleParams<T>
  publish: PublishModuleParams<T>
  runModule: RunModuleParams<T>
  testModule: TestModuleParams<T>
  getTestResult: GetTestResultParams<T>
}

export interface ModuleActionOutputs extends ServiceActionOutputs {
  describeType: Promise<ModuleTypeDescription>
  configure: Promise<ConfigureModuleResult>
  getBuildStatus: Promise<BuildStatus>
  build: Promise<BuildResult>
  publish: Promise<PublishResult>
  runModule: Promise<RunResult>
  testModule: Promise<TestResult>
  getTestResult: Promise<TestResult | null>
}

export const moduleActionDescriptions: {
  [P in ModuleActionName | ServiceActionName | TaskActionName]: PluginActionDescription
} = {
  describeType,
  configure,
  getBuildStatus,
  build,
  publish: publishModule,
  runModule,
  testModule,
  getTestResult,

  ...serviceActionDescriptions,
  ...taskActionDescriptions,
}

export const pluginActionNames: PluginActionName[] = <PluginActionName[]>Object.keys(pluginActionDescriptions)
export const moduleActionNames: ModuleActionName[] = <ModuleActionName[]>Object.keys(moduleActionDescriptions)

export interface GardenPlugin {
  configSchema?: Joi.ObjectSchema
  configKeys?: string[]
  outputsSchema?: Joi.ObjectSchema

  dependencies?: string[]

  actions?: Partial<PluginActions>
  moduleActions?: { [moduleType: string]: Partial<ModuleAndRuntimeActions> }

  commands?: PluginCommand[]
}

export interface PluginFactoryParams {
  log: LogNode
  projectName: string
}

export interface PluginFactory {
  (params: PluginFactoryParams): GardenPlugin | Promise<GardenPlugin>
}
export type RegisterPluginParam = string | PluginFactory
export interface Plugins {
  [name: string]: RegisterPluginParam
}

export const pluginSchema = joi
  .object()
  .keys({
    // TODO: make this a JSON/OpenAPI schema for portability
    configSchema: joi
      .object({
        isJoi: joi
          .boolean()
          .only(true)
          .required(),
      })
      .unknown(true),
    outputsSchema: joi
      .object({
        isJoi: joi
          .boolean()
          .only(true)
          .required(),
      })
      .unknown(true),
    dependencies: joiArray(joi.string()).description(deline`
        Names of plugins that need to be configured prior to this plugin. This plugin will be able to reference the
        configuration from the listed plugins. Note that the dependencies will not be implicitly configured—the user
        will need to explicitly configure them in their project configuration.
      `),
    // TODO: document plugin actions further
    actions: joi
      .object()
      .keys(mapValues(pluginActionDescriptions, () => joi.func()))
      .description("A map of plugin action handlers provided by the plugin."),
    moduleActions: joiIdentifierMap(
      joi
        .object()
        .keys(mapValues(moduleActionDescriptions, () => joi.func()))
        .description("A map of module names and module action handlers provided by the plugin.")
    ),
    commands: joi
      .array()
      .items(pluginCommandSchema)
      .unique("name")
      .description("List of commands that this plugin exposes (via `garden plugins <plugin name>`"),
  })
  .description("The schema for Garden plugins.")

export const pluginModuleSchema = joi
  .object()
  .keys({
    name: joiIdentifier(),
    gardenPlugin: joi
      .func()
      .required()
      .description("The initialization function for the plugin. Should return a valid Garden plugin object."),
  })
  .unknown(true)
  .description("A module containing a Garden plugin.")
