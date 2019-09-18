import {
  ModuleAndRuntimeActions,
  PluginActions,
  PluginFactory,
  moduleActionDescriptions,
  pluginActionDescriptions,
} from "../../../src/types/plugin/plugin"
import { Service, ServiceState } from "../../../src/types/service"
import { RuntimeContext, prepareRuntimeContext } from "../../../src/runtime-context"
import { expectError, makeTestGardenA } from "../../helpers"
import { ActionHelper } from "../../../src/actions"
import { Garden } from "../../../src/garden"
import { LogEntry } from "../../../src/logger/log-entry"
import { Module } from "../../../src/types/module"
import { ServiceLogEntry } from "../../../src/types/plugin/service/getServiceLogs"
import Stream from "ts-stream"
import { Task } from "../../../src/types/task"
import { expect } from "chai"
import { omit } from "lodash"
import { validate, joi } from "../../../src/config/common"

const now = new Date()

describe("ActionHelper", () => {
  let garden: Garden
  let log: LogEntry
  let actions: ActionHelper
  let module: Module
  let service: Service
  let runtimeContext: RuntimeContext
  let task: Task

  before(async () => {
    const plugins = { "test-plugin": testPlugin, "test-plugin-b": testPluginB }
    garden = await makeTestGardenA(plugins)
    log = garden.log
    actions = await garden.getActionHelper()
    const graph = await garden.getConfigGraph()
    module = await graph.getModule("module-a")
    service = await graph.getService("service-a")
    runtimeContext = await prepareRuntimeContext({
      garden,
      graph,
      dependencies: {
        build: [],
        service: [],
        task: [],
        test: [],
      },
      module,
      serviceStatuses: {},
      taskResults: {},
    })
    task = await graph.getTask("task-a")
  })

  // Note: The test plugins below implicitly validate input params for each of the tests
  describe("environment actions", () => {
    describe("getEnvironmentStatus", () => {
      it("should return the environment status for a provider", async () => {
        const result = await actions.getEnvironmentStatus({
          log,
          pluginName: "test-plugin",
        })
        expect(result).to.eql({
          ready: false,
          outputs: {},
          dashboardPages: [],
        })
      })
    })

    describe("prepareEnvironment", () => {
      it("should prepare the environment for a configured provider", async () => {
        const result = await actions.prepareEnvironment({
          log,
          pluginName: "test-plugin",
          force: false,
          status: { ready: true, outputs: {} },
        })
        expect(result).to.eql({
          status: {
            ready: true,
            outputs: {},
            dashboardPages: [],
          },
        })
      })
    })

    describe("cleanupEnvironment", () => {
      it("should clean up environment for a provider", async () => {
        const result = await actions.cleanupEnvironment({
          log,
          pluginName: "test-plugin",
        })
        expect(result).to.eql({})
      })
    })

    describe("getSecret", () => {
      it("should retrieve a secret from the specified provider", async () => {
        const result = await actions.getSecret({
          log,
          pluginName: "test-plugin",
          key: "foo",
        })
        expect(result).to.eql({ value: "foo" })
      })
    })

    describe("setSecret", () => {
      it("should set a secret via the specified provider", async () => {
        const result = await actions.setSecret({
          log,
          pluginName: "test-plugin",
          key: "foo",
          value: "boo",
        })
        expect(result).to.eql({})
      })
    })

    describe("deleteSecret", () => {
      it("should delete a secret from the specified provider", async () => {
        const result = await actions.deleteSecret({
          log,
          pluginName: "test-plugin",
          key: "foo",
        })
        expect(result).to.eql({ found: true })
      })
    })
  })

  describe("module actions", () => {
    describe("getBuildStatus", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.getBuildStatus({ log, module })
        expect(result).to.eql({
          ready: true,
        })
      })
    })

    describe("build", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.build({ log, module })
        expect(result).to.eql({})
      })
    })

    describe("hotReloadService", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.hotReloadService({
          log,
          service,
          runtimeContext: {
            envVars: { FOO: "bar" },
            dependencies: [],
          },
        })
        expect(result).to.eql({})
      })
    })

    describe("runModule", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const command = ["npm", "run"]
        const result = await actions.runModule({
          log,
          module,
          args: command,
          interactive: true,
          runtimeContext: {
            envVars: { FOO: "bar" },
            dependencies: [],
          },
        })
        expect(result).to.eql({
          moduleName: module.name,
          command,
          completedAt: now,
          log: "bla bla",
          success: true,
          startedAt: now,
          version: module.version.versionString,
        })
      })
    })

    describe("testModule", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.testModule({
          log,
          module,
          interactive: true,
          runtimeContext: {
            envVars: { FOO: "bar" },
            dependencies: [],
          },
          silent: false,
          testConfig: {
            name: "test",
            dependencies: [],
            timeout: 1234,
            spec: {},
          },
          testVersion: module.version,
        })
        expect(result).to.eql({
          moduleName: module.name,
          command: [],
          completedAt: now,
          log: "bla bla",
          outputs: {
            log: "bla bla",
          },
          success: true,
          startedAt: now,
          testName: "test",
          version: module.version.versionString,
        })
      })
    })

    describe("getTestResult", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.getTestResult({
          log,
          module,
          testName: "test",
          testVersion: module.version,
        })
        expect(result).to.eql({
          moduleName: module.name,
          command: [],
          completedAt: now,
          log: "bla bla",
          outputs: {
            log: "bla bla",
          },
          success: true,
          startedAt: now,
          testName: "test",
          version: module.version.versionString,
        })
      })
    })
  })

  describe("service actions", () => {
    describe("getServiceStatus", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.getServiceStatus({
          log,
          service,
          runtimeContext,
          hotReload: false,
        })
        expect(result).to.eql({ forwardablePorts: [], state: "ready" })
      })

      it("should resolve runtime template strings", async () => {
        const result = await actions.getServiceStatus({
          log,
          service,
          runtimeContext,
          hotReload: false,
        })
        expect(result).to.eql({ forwardablePorts: [], state: "ready" })
      })
    })

    describe("deployService", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.deployService({
          log,
          service,
          runtimeContext,
          force: true,
          hotReload: false,
        })
        expect(result).to.eql({ forwardablePorts: [], state: "ready" })
      })
    })

    describe("deleteService", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.deleteService({
          log,
          service,
          runtimeContext,
        })
        expect(result).to.eql({ forwardablePorts: [], state: "ready" })
      })
    })

    describe("execInService", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.execInService({
          log,
          service,
          runtimeContext,
          command: ["foo"],
          interactive: false,
        })
        expect(result).to.eql({ code: 0, output: "bla bla" })
      })
    })

    describe("getServiceLogs", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const stream = new Stream<ServiceLogEntry>()
        const result = await actions.getServiceLogs({
          log,
          service,
          runtimeContext,
          stream,
          follow: false,
          tail: -1,
        })
        expect(result).to.eql({})
      })
    })

    describe("runService", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.runService({
          log,
          service,
          interactive: true,
          runtimeContext: {
            envVars: { FOO: "bar" },
            dependencies: [],
          },
        })
        expect(result).to.eql({
          moduleName: service.module.name,
          command: ["foo"],
          completedAt: now,
          log: "bla bla",
          success: true,
          startedAt: now,
          version: service.module.version.versionString,
        })
      })
    })
  })

  describe("task actions", () => {
    describe("getTaskResult", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.getTaskResult({
          log,
          task,
          taskVersion: task.module.version,
        })
        expect(result).to.eql({
          moduleName: task.module.name,
          taskName: task.name,
          command: ["foo"],
          completedAt: now,
          log: "bla bla",
          outputs: {
            log: "bla bla",
          },
          success: true,
          startedAt: now,
          version: task.module.version.versionString,
        })
      })
    })

    describe("runTask", () => {
      it("should correctly call the corresponding plugin handler", async () => {
        const result = await actions.runTask({
          log,
          task,
          interactive: true,
          runtimeContext: {
            envVars: { FOO: "bar" },
            dependencies: [],
          },
          taskVersion: task.module.version,
        })
        expect(result).to.eql({
          moduleName: task.module.name,
          taskName: task.name,
          command: ["foo"],
          completedAt: now,
          log: "bla bla",
          outputs: {
            log: "bla bla",
          },
          success: true,
          startedAt: now,
          version: task.module.version.versionString,
        })
      })
    })
  })

  describe("getActionHandlers", () => {
    it("should return all handlers for a type", async () => {
      const handlers = await actions.getActionHandlers("prepareEnvironment")

      expect(Object.keys(handlers)).to.eql(["test-plugin", "test-plugin-b"])
    })
  })

  describe("getModuleActionHandlers", () => {
    it("should return all handlers for a type", async () => {
      const handlers = await actions.getModuleActionHandlers({
        actionType: "build",
        moduleType: "exec",
      })

      expect(Object.keys(handlers)).to.eql(["exec"])
    })
  })

  describe("getActionHandler", () => {
    it("should return the configured handler for specified action type and plugin name", async () => {
      const gardenA = await makeTestGardenA()
      const actionsA = await gardenA.getActionHelper()
      const pluginName = "test-plugin-b"
      const handler = await actionsA.getActionHandler({
        actionType: "prepareEnvironment",
        pluginName,
      })

      expect(handler["actionType"]).to.equal("prepareEnvironment")
      expect(handler["pluginName"]).to.equal(pluginName)
    })

    it("should throw if no handler is available", async () => {
      const gardenA = await makeTestGardenA()
      const actionsA = await gardenA.getActionHelper()
      const pluginName = "test-plugin-b"
      await expectError(
        () =>
          actionsA.getActionHandler({
            actionType: "cleanupEnvironment",
            pluginName,
          }),
        "plugin"
      )
    })
  })

  describe("getModuleActionHandler", () => {
    it("should return last configured handler for specified module action type", async () => {
      const gardenA = await makeTestGardenA()
      const actionsA = await gardenA.getActionHelper()
      const handler = await actionsA.getModuleActionHandler({
        actionType: "deployService",
        moduleType: "test",
      })

      expect(handler["actionType"]).to.equal("deployService")
      expect(handler["pluginName"]).to.equal("test-plugin-b")
    })

    it("should throw if no handler is available", async () => {
      const gardenA = await makeTestGardenA()
      const actionsA = await gardenA.getActionHelper()
      await expectError(
        () =>
          actionsA.getModuleActionHandler({
            actionType: "execInService",
            moduleType: "container",
          }),
        "parameter"
      )
    })
  })

  describe("callServiceHandler", () => {
    it("should interpolate runtime template strings", async () => {
      const emptyActions = new ActionHelper(garden, {})

      garden["moduleConfigs"]["module-a"].spec.foo = "${runtime.services.service-b.outputs.foo}"

      const graph = await garden.getConfigGraph()
      const serviceA = await graph.getService("service-a")
      const serviceB = await graph.getService("service-b")

      const _runtimeContext = await prepareRuntimeContext({
        garden,
        graph,
        dependencies: {
          build: [],
          service: [serviceB],
          task: [],
          test: [],
        },
        module: serviceA.module,
        serviceStatuses: {
          "service-b": {
            outputs: { foo: "bar" },
          },
        },
        taskResults: {},
      })

      await emptyActions["callServiceHandler"]({
        actionType: "deployService", // Doesn't matter which one it is
        params: {
          service: serviceA,
          runtimeContext: _runtimeContext,
          log,
          hotReload: false,
          force: false,
        },
        defaultHandler: async (params) => {
          expect(params.module.spec.foo).to.equal("bar")

          return { forwardablePorts: [], state: <ServiceState>"ready" }
        },
      })
    })

    it("should throw if one or more runtime variables remain unresolved after re-resolution", async () => {
      const emptyActions = new ActionHelper(garden, {})

      garden["moduleConfigs"]["module-a"].spec.services[0].foo = "${runtime.services.service-b.outputs.foo}"

      const graph = await garden.getConfigGraph()
      const serviceA = await graph.getService("service-a")

      const _runtimeContext = await prepareRuntimeContext({
        garden,
        graph,
        dependencies: {
          build: [],
          service: [],
          task: [],
          test: [],
        },
        module: serviceA.module,
        serviceStatuses: {},
        taskResults: {},
      })

      await expectError(
        () =>
          emptyActions["callServiceHandler"]({
            actionType: "deployService", // Doesn't matter which one it is
            params: {
              service: serviceA,
              runtimeContext: _runtimeContext,
              log,
              hotReload: false,
              force: false,
            },
            defaultHandler: async () => {
              return {} as any
            },
          }),
        (err) =>
          expect(err.message).to.equal(
            "Unable to resolve one or more runtime template values for service 'service-a': " +
              "${runtime.services.service-b.outputs.foo}"
          )
      )
    })
  })

  describe("callTaskHandler", () => {
    it("should interpolate runtime template strings", async () => {
      const emptyActions = new ActionHelper(garden, {})

      garden["moduleConfigs"]["module-a"].spec.tasks[0].foo = "${runtime.services.service-b.outputs.foo}"

      const graph = await garden.getConfigGraph()
      const taskA = await graph.getTask("task-a")
      const serviceB = await graph.getService("service-b")

      const _runtimeContext = await prepareRuntimeContext({
        garden,
        graph,
        dependencies: {
          build: [],
          service: [serviceB],
          task: [],
          test: [],
        },
        module: taskA.module,
        serviceStatuses: {
          "service-b": {
            outputs: { foo: "bar" },
          },
        },
        taskResults: {},
      })

      await emptyActions["callTaskHandler"]({
        actionType: "runTask",
        params: {
          task: taskA,
          runtimeContext: _runtimeContext,
          log,
          taskVersion: task.module.version,
          interactive: false,
        },
        defaultHandler: async (params) => {
          expect(params.task.spec.foo).to.equal("bar")

          return {
            moduleName: "module-b",
            taskName: "task-b",
            command: [],
            outputs: { moo: "boo" },
            success: true,
            version: task.module.version.versionString,
            startedAt: new Date(),
            completedAt: new Date(),
            log: "boo",
          }
        },
      })
    })

    it("should throw if one or more runtime variables remain unresolved after re-resolution", async () => {
      const emptyActions = new ActionHelper(garden, {})

      garden["moduleConfigs"]["module-a"].spec.tasks[0].foo = "${runtime.services.service-b.outputs.foo}"

      const graph = await garden.getConfigGraph()
      const taskA = await graph.getTask("task-a")

      const _runtimeContext = await prepareRuntimeContext({
        garden,
        graph,
        dependencies: {
          build: [],
          service: [],
          task: [],
          test: [],
        },
        module: taskA.module,
        // Omitting the service-b outputs here
        serviceStatuses: {},
        taskResults: {},
      })

      await expectError(
        () =>
          emptyActions["callTaskHandler"]({
            actionType: "runTask",
            params: {
              task: taskA,
              runtimeContext: _runtimeContext,
              log,
              taskVersion: task.module.version,
              interactive: false,
            },
            defaultHandler: async () => {
              return {} as any
            },
          }),
        (err) =>
          expect(err.message).to.equal(
            "Unable to resolve one or more runtime template values for task 'task-a': " +
              "${runtime.services.service-b.outputs.foo}"
          )
      )
    })
  })
})

const testPlugin: PluginFactory = async () => ({
  actions: <PluginActions>{
    getEnvironmentStatus: async (params) => {
      validate(params, pluginActionDescriptions.getEnvironmentStatus.paramsSchema)
      return {
        ready: false,
        outputs: {},
      }
    },

    prepareEnvironment: async (params) => {
      validate(params, pluginActionDescriptions.prepareEnvironment.paramsSchema)
      return { status: { ready: true, outputs: {} } }
    },

    cleanupEnvironment: async (params) => {
      validate(params, pluginActionDescriptions.cleanupEnvironment.paramsSchema)
      return {}
    },

    getSecret: async (params) => {
      validate(params, pluginActionDescriptions.getSecret.paramsSchema)
      return { value: params.key }
    },

    setSecret: async (params) => {
      validate(params, pluginActionDescriptions.setSecret.paramsSchema)
      return {}
    },

    deleteSecret: async (params) => {
      validate(params, pluginActionDescriptions.deleteSecret.paramsSchema)
      return { found: true }
    },
  },
  moduleActions: {
    test: <ModuleAndRuntimeActions>{
      describeType: async (params) => {
        validate(params, moduleActionDescriptions.describeType.paramsSchema)
        return {
          docs: "bla bla bla",
          moduleOutputsSchema: joi.object(),
          serviceOutputsSchema: joi.object(),
          taskOutputsSchema: joi.object(),
          schema: joi.object(),
          title: "Bla",
        }
      },

      configure: async (params) => {
        validate(params, moduleActionDescriptions.configure.paramsSchema)

        const serviceConfigs = params.moduleConfig.spec.services.map((spec) => ({
          name: spec.name,
          dependencies: spec.dependencies || [],
          hotReloadable: false,
          spec,
        }))

        const taskConfigs = (params.moduleConfig.spec.tasks || []).map((spec) => ({
          name: spec.name,
          dependencies: spec.dependencies || [],
          spec,
        }))

        return {
          ...params.moduleConfig,
          serviceConfigs,
          taskConfigs,
        }
      },

      getBuildStatus: async (params) => {
        validate(params, moduleActionDescriptions.getBuildStatus.paramsSchema)
        return { ready: true }
      },

      build: async (params) => {
        validate(params, moduleActionDescriptions.build.paramsSchema)
        return {}
      },

      publish: async (params) => {
        validate(params, moduleActionDescriptions.publish.paramsSchema)
        return { published: true }
      },

      hotReloadService: async (params) => {
        validate(params, moduleActionDescriptions.hotReloadService.paramsSchema)
        return {}
      },

      runModule: async (params) => {
        validate(params, moduleActionDescriptions.runModule.paramsSchema)
        return {
          moduleName: params.module.name,
          command: params.args,
          completedAt: now,
          log: "bla bla",
          success: true,
          startedAt: now,
          version: params.module.version.versionString,
        }
      },

      testModule: async (params) => {
        validate(params, moduleActionDescriptions.testModule.paramsSchema)
        return {
          moduleName: params.module.name,
          command: [],
          completedAt: now,
          log: "bla bla",
          outputs: {
            log: "bla bla",
          },
          success: true,
          startedAt: now,
          testName: params.testConfig.name,
          version: params.module.version.versionString,
        }
      },

      getTestResult: async (params) => {
        validate(params, moduleActionDescriptions.getTestResult.paramsSchema)
        return {
          moduleName: params.module.name,
          command: [],
          completedAt: now,
          log: "bla bla",
          outputs: {
            log: "bla bla",
          },
          success: true,
          startedAt: now,
          testName: params.testName,
          version: params.module.version.versionString,
        }
      },

      getServiceStatus: async (params) => {
        validate(params, moduleActionDescriptions.getServiceStatus.paramsSchema)
        return { state: "ready" }
      },

      deployService: async (params) => {
        validate(params, moduleActionDescriptions.deployService.paramsSchema)
        return { state: "ready" }
      },

      deleteService: async (params) => {
        validate(params, moduleActionDescriptions.deleteService.paramsSchema)
        return { state: "ready" }
      },

      execInService: async (params) => {
        validate(params, moduleActionDescriptions.execInService.paramsSchema)
        return {
          code: 0,
          output: "bla bla",
        }
      },

      getServiceLogs: async (params) => {
        validate(params, moduleActionDescriptions.getServiceLogs.paramsSchema)
        return {}
      },

      runService: async (params) => {
        validate(params, moduleActionDescriptions.runService.paramsSchema)
        return {
          moduleName: params.module.name,
          command: ["foo"],
          completedAt: now,
          log: "bla bla",
          success: true,
          startedAt: now,
          version: params.module.version.versionString,
        }
      },

      getPortForward: async (params) => {
        validate(params, moduleActionDescriptions.getPortForward.paramsSchema)
        return {
          hostname: "bla",
          port: 123,
        }
      },

      stopPortForward: async (params) => {
        validate(params, moduleActionDescriptions.stopPortForward.paramsSchema)
        return {}
      },

      getTaskResult: async (params) => {
        validate(params, moduleActionDescriptions.getTaskResult.paramsSchema)
        const module = params.task.module
        return {
          moduleName: module.name,
          taskName: params.task.name,
          command: ["foo"],
          completedAt: now,
          log: "bla bla",
          outputs: {
            log: "bla bla",
          },
          success: true,
          startedAt: now,
          version: params.module.version.versionString,
        }
      },

      runTask: async (params) => {
        validate(params, moduleActionDescriptions.runTask.paramsSchema)
        const module = params.task.module
        return {
          moduleName: module.name,
          taskName: params.task.name,
          command: ["foo"],
          completedAt: now,
          log: "bla bla",
          outputs: {
            log: "bla bla",
          },
          success: true,
          startedAt: now,
          version: params.module.version.versionString,
        }
      },
    },
  },
})

const testPluginB: PluginFactory = async (params) => omit(await testPlugin(params), ["moduleActions"])
