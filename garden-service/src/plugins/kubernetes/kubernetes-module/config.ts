/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { ServiceSpec, dependenciesSchema } from "../../../config/service"
import { joiArray, joi } from "../../../config/common"
import { Module } from "../../../types/module"
import { ConfigureModuleParams, ConfigureModuleResult } from "../../../types/plugin/module/configure"
import { Service } from "../../../types/service"
import { ContainerModule } from "../../container/config"
import { baseBuildSpecSchema } from "../../../config/module"
import { KubernetesResource } from "../types"
import { deline, dedent } from "../../../util/string"

// A Kubernetes Module always maps to a single Service
export type KubernetesModuleSpec = KubernetesServiceSpec

export interface KubernetesModule extends Module<KubernetesModuleSpec, KubernetesServiceSpec> {}
export type KubernetesModuleConfig = KubernetesModule["_ConfigType"]

export interface KubernetesServiceSpec extends ServiceSpec {
  dependencies: string[]
  files: string[]
  manifests: KubernetesResource[]
}

export type KubernetesService = Service<KubernetesModule, ContainerModule>

const kubernetesResourceSchema = joi
  .object()
  .keys({
    apiVersion: joi
      .string()
      .required()
      .description("The API version of the resource."),
    kind: joi
      .string()
      .required()
      .description("The kind of the resource."),
    metadata: joi
      .object()
      .required()
      .keys({
        name: joi
          .string()
          .required()
          .description("The name of the resource."),
      })
      .unknown(true),
  })
  .unknown(true)

const kubernetesModuleSpecSchema = joi.object().keys({
  build: baseBuildSpecSchema,
  dependencies: dependenciesSchema,
  manifests: joiArray(kubernetesResourceSchema).description(
    deline`
          List of Kubernetes resource manifests to deploy. Use this instead of the \`files\` field if you need to
          resolve template strings in any of the manifests.`
  ),
  files: joiArray(joi.string().posixPath({ subPathOnly: true })).description(
    "POSIX-style paths to YAML files to load manifests from. Each can contain multiple manifests."
  ),
})

export async function describeType() {
  return {
    docs: dedent`
      Specify one or more Kubernetes manifests to deploy.

      You can either (or both) specify the manifests as part of the \`garden.yml\` configuration, or you can refer to
      one or more files with existing manifests.

      Note that if you include the manifests in the \`garden.yml\` file, you can use
      [template strings](https://docs.garden.io/reference/template-strings) to interpolate values into the manifests.

      If you need more advanced templating features you can use the
      [helm](https://docs.garden.io/reference/module-types/helm) module type.
    `,
    moduleOutputsSchema: joi.object().keys({}),
    schema: kubernetesModuleSpecSchema,
  }
}

export async function configureKubernetesModule({
  moduleConfig,
}: ConfigureModuleParams<KubernetesModule>): Promise<ConfigureModuleResult<KubernetesModule>> {
  moduleConfig.serviceConfigs = [
    {
      name: moduleConfig.name,
      dependencies: moduleConfig.spec.dependencies,
      hotReloadable: false,
      spec: moduleConfig.spec,
    },
  ]

  return moduleConfig
}
