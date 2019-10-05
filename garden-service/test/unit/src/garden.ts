import { expect } from "chai"
import td from "testdouble"
import tmp from "tmp-promise"
import { join, resolve } from "path"
import { Garden } from "../../../src/garden"
import {
  dataDir,
  expectError,
  makeTestGarden,
  makeTestGardenA,
  projectRootA,
  getDataDir,
  testModuleVersion,
  TestGarden,
  testPlugin,
  makeExtProjectSourcesGarden,
  makeExtModuleSourcesGarden,
  testGitUrlHash,
  resetLocalConfig,
  testGitUrl,
} from "../../helpers"
import { getNames, findByName } from "../../../src/util/util"
import { MOCK_CONFIG } from "../../../src/cli/cli"
import { LinkedSource } from "../../../src/config-store"
import { ModuleVersion } from "../../../src/vcs/vcs"
import { getModuleCacheContext } from "../../../src/types/module"
import { createGardenPlugin, GardenPlugin } from "../../../src/types/plugin/plugin"
import { ConfigureProviderParams } from "../../../src/types/plugin/provider/configureProvider"
import { ProjectConfig } from "../../../src/config/project"
import { ModuleConfig } from "../../../src/config/module"
import { DEFAULT_API_VERSION } from "../../../src/constants"
import { providerConfigBaseSchema } from "../../../src/config/provider"
import { keyBy, set } from "lodash"
import stripAnsi from "strip-ansi"
import { joi } from "../../../src/config/common"
import { defaultDotIgnoreFiles } from "../../../src/util/fs"
import { realpath, writeFile } from "fs-extra"
import { dedent, deline } from "../../../src/util/string"

describe("Garden", () => {
  beforeEach(async () => {
    td.replace(Garden.prototype, "resolveVersion", async () => testModuleVersion)
  })

  describe("factory", () => {
    it("should initialize and add the action handlers for a plugin", async () => {
      const garden = await makeTestGardenA()
      const actions = await garden.getActionRouter()

      expect((<any>actions).actionHandlers.prepareEnvironment["test-plugin"]).to.be.ok
      expect((<any>actions).actionHandlers.prepareEnvironment["test-plugin-b"]).to.be.ok
    })

    it("should initialize with MOCK_CONFIG", async () => {
      const garden = await Garden.factory("./", { config: MOCK_CONFIG })
      expect(garden).to.be.ok
    })

    it("should initialize a project with config files with yaml and yml extensions", async () => {
      const garden = await makeTestGarden(getDataDir("test-project-yaml-file-extensions"))
      expect(garden).to.be.ok
    })

    it("should always exclude the garden dir", async () => {
      const gardenA = await makeTestGardenA()
      const gardenCustomDir = await makeTestGarden(getDataDir("test-project-a"), {
        gardenDirPath: "custom/garden-dir",
      })
      expect(gardenA.moduleExcludePatterns).to.include(".garden/**/*")
      expect(gardenCustomDir.moduleExcludePatterns).to.include("custom/garden-dir/**/*")
    })

    it("should throw if a project has config files with yaml and yml extensions in the same dir", async () => {
      const path = getDataDir("test-project-duplicate-yaml-file-extensions")
      await expectError(async () => makeTestGarden(path), "validation")
    })

    it("should parse and resolve the config from the project root", async () => {
      const garden = await makeTestGardenA()
      const projectRoot = garden.projectRoot

      const testPluginProvider = {
        name: "test-plugin",
        config: {
          name: "test-plugin",
          environments: ["local"],
          path: projectRoot,
        },
        dependencies: [],
        moduleConfigs: [],
        status: {
          ready: true,
          outputs: {},
        },
      }

      expect(garden.projectName).to.equal("test-project-a")

      expect(await garden.resolveProviders()).to.eql([
        emptyProvider(projectRoot, "exec"),
        emptyProvider(projectRoot, "container"),
        emptyProvider(projectRoot, "maven-container"),
        testPluginProvider,
        {
          name: "test-plugin-b",
          config: {
            name: "test-plugin-b",
            environments: ["local"],
            path: projectRoot,
          },
          dependencies: [testPluginProvider],
          moduleConfigs: [],
          status: {
            ready: true,
            outputs: {},
          },
        },
      ])

      expect(garden.variables).to.eql({
        some: "variable",
      })
    })

    it("should resolve templated env variables in project config", async () => {
      process.env.TEST_PROVIDER_TYPE = "test-plugin"
      process.env.TEST_VARIABLE = "banana"

      const projectRoot = join(dataDir, "test-project-templated")

      const garden = await makeTestGarden(projectRoot)

      delete process.env.TEST_PROVIDER_TYPE
      delete process.env.TEST_VARIABLE

      expect(await garden.resolveProviders()).to.eql([
        emptyProvider(projectRoot, "exec"),
        emptyProvider(projectRoot, "container"),
        emptyProvider(projectRoot, "maven-container"),
        {
          name: "test-plugin",
          config: {
            name: "test-plugin",
            path: projectRoot,
            environments: ["local"],
          },
          dependencies: [],
          moduleConfigs: [],
          status: {
            ready: true,
            outputs: {},
          },
        },
      ])

      expect(garden.variables).to.eql({
        "some": "banana",
        "service-a-build-command": "OK",
      })
    })

    it("should throw if the specified environment isn't configured", async () => {
      await expectError(async () => Garden.factory(projectRootA, { environmentName: "bla" }), "parameter")
    })

    it("should throw if environment starts with 'garden-'", async () => {
      await expectError(async () => Garden.factory(projectRootA, { environmentName: "garden-bla" }), "parameter")
    })

    it("should throw if plugin module exports invalid name", async () => {
      const pluginPath = join(__dirname, "plugins", "invalid-name.js")
      const plugins = [pluginPath]
      const projectRoot = join(dataDir, "test-project-empty")
      await expectError(async () => Garden.factory(projectRoot, { plugins }), "plugin")
    })

    it("should throw if plugin module doesn't contain plugin", async () => {
      const pluginPath = join(__dirname, "plugins", "missing-plugin.js")
      const plugins = [pluginPath]
      const projectRoot = join(dataDir, "test-project-empty")
      await expectError(async () => Garden.factory(projectRoot, { plugins }), "plugin")
    })

    it("should set .garden as the default cache dir", async () => {
      const projectRoot = join(dataDir, "test-project-empty")
      const garden = await Garden.factory(projectRoot, { plugins: [testPlugin] })
      expect(garden.gardenDirPath).to.eql(join(projectRoot, ".garden"))
    })

    it("should optionally set a custom cache dir relative to project root", async () => {
      const projectRoot = join(dataDir, "test-project-empty")
      const garden = await Garden.factory(projectRoot, {
        plugins: [testPlugin],
        gardenDirPath: "my/cache/dir",
      })
      expect(garden.gardenDirPath).to.eql(join(projectRoot, "my/cache/dir"))
    })

    it("should optionally set a custom cache dir with an absolute path", async () => {
      const projectRoot = join(dataDir, "test-project-empty")
      const gardenDirPath = join(dataDir, "test-garden-dir")
      const garden = await Garden.factory(projectRoot, {
        plugins: [testPlugin],
        gardenDirPath,
      })
      expect(garden.gardenDirPath).to.eql(gardenDirPath)
    })

    it("should load default varfiles if they exist", async () => {
      const projectRoot = join(dataDir, "test-projects", "varfiles")
      const garden = await Garden.factory(projectRoot, {})
      expect(garden.variables).to.eql({
        a: "a",
        b: "B",
        c: "c",
      })
    })

    it("should load custom varfiles if specified", async () => {
      const projectRoot = join(dataDir, "test-projects", "varfiles-custom")
      const garden = await Garden.factory(projectRoot, {})
      expect(garden.variables).to.eql({
        a: "a",
        b: "B",
        c: "c",
      })
    })

    it("should throw if project root is not in a git repo root", async () => {
      const tmpDir = await tmp.dir({ unsafeCleanup: true })

      try {
        const tmpPath = await realpath(tmpDir.path)
        await writeFile(join(tmpPath, "garden.yml"), dedent`
          kind: Project
          name: foo
        `)
        await expectError(async () => Garden.factory(tmpPath, {}), "runtime")
      } finally {
        await tmpDir.cleanup()
      }
    })
  })

  describe("getPlugins", () => {
    it("should throw if multiple plugins declare the same module type", async () => {
      const testPluginDupe = {
        ...testPlugin,
        name: "test-plugin-dupe",
      }
      const garden = await makeTestGardenA([testPluginDupe])

      garden["providerConfigs"].push({ name: "test-plugin-dupe" })

      await expectError(
        () => garden.getPlugins(),
        (err) => expect(err.message).to.equal(
          "Module type 'test' is declared in multiple providers: test-plugin, test-plugin-dupe.",
        ),
      )
    })

    it("should throw if a plugin extends a module type that hasn't been declared elsewhere", async () => {
      const plugin = {
        name: "foo",
        extendModuleTypes: [{
          name: "bar",
          handlers: {
            configure: async ({ moduleConfig }) => {
              return moduleConfig
            },
          },
        }],
      }
      const garden = await makeTestGardenA([plugin])

      garden["providerConfigs"].push({ name: "foo" })

      await expectError(
        () => garden.getPlugins(),
        (err) => expect(err.message).to.equal(deline`
          Plugin 'foo' extends module type 'bar' but the module type has not been declared.
          The 'foo' plugin is likely missing a dependency declaration.
          Please report an issue with the author.
        `),
      )
    })

    it("should throw if a plugin extends a known module type but doesn't declare dependency on the base", async () => {
      const plugin = {
        name: "foo",
        extendModuleTypes: [{
          name: "test",
          handlers: {
            configure: async ({ moduleConfig }) => {
              return moduleConfig
            },
          },
        }],
      }
      const garden = await makeTestGardenA([plugin])

      garden["providerConfigs"].push({ name: "foo" })

      await expectError(
        () => garden.getPlugins(),
        (err) => expect(err.message).to.equal(deline`
          Plugin 'foo' extends module type 'test', declared by the 'test-plugin' plugin,
          but does not specify a dependency on that plugin. Plugins must explicitly declare dependencies on plugins
          that define module types they reference. Please report an issue with the author.
        `),
      )
    })

    context("when a plugin has a base defined", () => {
      const path = process.cwd()
      const projectConfig: ProjectConfig = {
        apiVersion: DEFAULT_API_VERSION,
        kind: "Project",
        name: "test",
        path,
        defaultEnvironment: "default",
        dotIgnoreFiles: [],
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "foo" },
        ],
        variables: {},
      }

      it("should add and deduplicate declared dependencies on top of the dependencies of the base", async () => {
        const base = {
          name: "base",
          dependencies: ["test-plugin", "test-plugin-b"],
        }
        const foo = {
          name: "foo",
          dependencies: ["test-plugin-b", "test-plugin-c"],
          base: "base",
        }

        const garden = await Garden.factory(path, {
          plugins: [base, foo],
          config: projectConfig,
        })

        const parsed = await garden.getPlugin("foo")

        expect(parsed.dependencies).to.eql(["test-plugin", "test-plugin-b", "test-plugin-c"])
      })

      it("should combine handlers from both plugins and attach a super to the handler when overriding", async () => {
        const base = {
          name: "base",
          handlers: {
            configureProvider: async ({ config }) => ({ config }),
            getEnvironmentStatus: async () => ({ ready: true, outputs: {} }),
          },
        }
        const foo = {
          name: "foo",
          base: "base",
          handlers: {
            configureProvider: async ({ config }) => ({ config }),
          },
        }

        const garden = await Garden.factory(path, {
          plugins: [base, foo],
          config: projectConfig,
        })

        const parsed = await garden.getPlugin("foo")

        expect(parsed.handlers!.getEnvironmentStatus).to.equal(base.handlers.getEnvironmentStatus)
        expect(parsed.handlers!.configureProvider!.super).to.equal(base.handlers.configureProvider)
        expect(parsed.handlers!.configureProvider!.super!.super).to.be.undefined
      })

      it("should combine commands from both plugins and attach a super to the handler when overriding", async () => {
        const base = {
          name: "base",
          commands: [
            {
              name: "foo",
              description: "foo",
              handler: () => ({ result: {} }),
            },
          ],
        }
        const foo = {
          name: "foo",
          base: "base",
          commands: [
            {
              name: "foo",
              description: "foo",
              handler: () => ({ result: {} }),
            },
            {
              name: "bar",
              description: "bar",
              handler: () => ({ result: {} }),
            },
          ],
        }

        const garden = await Garden.factory(path, {
          plugins: [base, foo],
          config: projectConfig,
        })

        const parsed = await garden.getPlugin("foo")

        expect(parsed.commands!.length).to.equal(2)
        expect(findByName(parsed.commands!, "foo")).to.eql({
          ...foo.commands[0],
          super: base.commands[0],
        })
        expect(findByName(parsed.commands!, "bar")).to.eql(foo.commands[1])
      })

      it("should combine defined module types from both plugins", async () => {
        const base: GardenPlugin = {
          name: "base",
          createModuleTypes: [
            {
              name: "foo",
              docs: "foo",
              schema: joi.object(),
              handlers: {},
            },
          ],
        }
        const foo: GardenPlugin = {
          name: "foo",
          base: "base",
          createModuleTypes: [
            {
              name: "bar",
              docs: "bar",
              schema: joi.object(),
              handlers: {},
            },
          ],
        }

        const garden = await Garden.factory(path, {
          plugins: [base, foo],
          config: projectConfig,
        })

        const parsed = await garden.getPlugin("foo")

        expect(findByName(parsed.createModuleTypes || [], "foo")!.name).to.equal("foo")
        expect(findByName(parsed.createModuleTypes || [], "bar")!.name).to.equal("bar")
      })

      it("should throw if attempting to redefine a module type defined in the base", async () => {
        const base: GardenPlugin = {
          name: "base",
          createModuleTypes: [
            {
              name: "foo",
              docs: "foo",
              schema: joi.object(),
              handlers: {},
            },
          ],
        }
        const foo: GardenPlugin = {
          name: "foo",
          base: "base",
          createModuleTypes: base.createModuleTypes,
        }

        const garden = await Garden.factory(path, {
          plugins: [base, foo],
          config: projectConfig,
        })

        await expectError(
          () => garden.getPlugins(),
          (err) => expect(err.message).to.equal(
            "Plugin 'foo' redeclares the 'foo' module type, already declared by its base.",
          ),
        )
      })

      it("should allow extending a module type from the base", async () => {
        const base: GardenPlugin = {
          name: "base",
          createModuleTypes: [
            {
              name: "foo",
              docs: "foo",
              schema: joi.object(),
              handlers: {
                configure: async ({ moduleConfig }) => ({ moduleConfig }),
                build: async () => ({}),
              },
            },
          ],
        }
        const foo: GardenPlugin = {
          name: "foo",
          base: "base",
          extendModuleTypes: [
            {
              name: "foo",
              handlers: {
                build: async () => ({}),
                getBuildStatus: async () => ({ ready: true }),
              },
            },
          ],
        }

        const garden = await Garden.factory(path, {
          plugins: [base, foo],
          config: projectConfig,
        })

        const parsed = await garden.getPlugin("foo")
        const created = findByName(parsed.createModuleTypes || [], "foo")
        const extended = findByName(parsed.extendModuleTypes || [], "foo")

        expect(created).to.exist
        expect(created!.name).to.equal("foo")
        expect(extended).to.exist
        expect(extended!.name).to.equal("foo")
      })

      it("should only extend (and not also create) a module type if the base is also a configured plugin", async () => {
        const base: GardenPlugin = {
          name: "base",
          createModuleTypes: [
            {
              name: "foo",
              docs: "foo",
              schema: joi.object(),
              handlers: {
                configure: async ({ moduleConfig }) => ({ moduleConfig }),
                build: async () => ({}),
              },
            },
          ],
        }
        const foo: GardenPlugin = {
          name: "foo",
          base: "base",
          extendModuleTypes: [
            {
              name: "foo",
              handlers: {
                build: async () => ({}),
                getBuildStatus: async () => ({ ready: true }),
              },
            },
          ],
        }

        const garden = await Garden.factory(path, {
          plugins: [base, foo],
          config: {
            ...projectConfig,
            providers: [
              ...projectConfig.providers,
              { name: "base" },
            ],
          },
        })

        const parsedFoo = await garden.getPlugin("foo")
        const parsedBase = await garden.getPlugin("base")

        expect(findByName(parsedBase.createModuleTypes || [], "foo")).to.exist
        expect(findByName(parsedFoo.createModuleTypes || [], "foo")).to.not.exist
        expect(findByName(parsedFoo.extendModuleTypes || [], "foo")).to.exist
      })

      it("should throw if the base plugin is not registered", async () => {
        const foo = {
          name: "foo",
          base: "base",
        }

        const garden = await Garden.factory(path, {
          plugins: [foo],
          config: projectConfig,
        })

        await expectError(
          () => garden.getPlugins(),
          (err) => expect(err.message).to.equal(
            "Plugin 'foo' is based on plugin 'base' which has not been registered.",
          ),
        )
      })

      it("should throw if plugins have circular bases", async () => {
        const foo = {
          name: "foo",
          base: "bar",
        }
        const bar = {
          name: "bar",
          base: "foo",
        }

        const garden = await Garden.factory(path, {
          plugins: [foo, bar],
          config: projectConfig,
        })

        await expectError(
          () => garden.getPlugins(),
          (err) => expect(err.message).to.equal(
            "One or more circular dependencies found between plugins and their bases: foo <- bar <- foo",
          ),
        )
      })

      context("when a plugin's base has a base defined", () => {
        it("should add and deduplicate declared dependencies for the whole chain", async () => {
          const baseA = {
            name: "base-a",
            dependencies: ["test-plugin"],
          }
          const b = {
            name: "b",
            dependencies: ["test-plugin", "test-plugin-b"],
            base: "base-a",
          }
          const foo = {
            name: "foo",
            dependencies: ["test-plugin-c"],
            base: "b",
          }

          const garden = await Garden.factory(path, {
            plugins: [baseA, b, foo],
            config: projectConfig,
          })

          const parsed = await garden.getPlugin("foo")

          expect(parsed.dependencies).to.eql(["test-plugin", "test-plugin-b", "test-plugin-c"])
        })

        it("should combine handlers from both plugins and recursively attach super handlers", async () => {
          const baseA = {
            name: "base-a",
            handlers: {
              configureProvider: async ({ config }) => ({ config }),
              getEnvironmentStatus: async () => ({ ready: true, outputs: {} }),
            },
          }
          const baseB = {
            name: "base-b",
            base: "base-a",
            handlers: {
              configureProvider: async ({ config }) => ({ config }),
            },
          }
          const foo = {
            name: "foo",
            base: "base-b",
            handlers: {
              configureProvider: async ({ config }) => ({ config }),
            },
          }

          const garden = await Garden.factory(path, {
            plugins: [baseA, baseB, foo],
            config: projectConfig,
          })

          const parsed = await garden.getPlugin("foo")

          expect(parsed.handlers!.getEnvironmentStatus).to.equal(baseA.handlers.getEnvironmentStatus)
          expect(parsed.handlers!.configureProvider!.super).to.equal(baseB.handlers.configureProvider)
          expect(parsed.handlers!.configureProvider!.super!.super).to.equal(baseA.handlers.configureProvider)
          expect(parsed.handlers!.configureProvider!.super!.super!.super).to.be.undefined
        })

        it("should combine commands from all plugins and recursively attach supers when overriding", async () => {
          const baseA = {
            name: "base-a",
            commands: [
              {
                name: "foo",
                description: "foo",
                handler: () => ({ result: {} }),
              },
            ],
          }
          const baseB = {
            name: "base-b",
            base: "base-a",
            commands: [
              {
                name: "foo",
                description: "foo",
                handler: () => ({ result: {} }),
              },
              {
                name: "bar",
                description: "bar",
                handler: () => ({ result: {} }),
              },
            ],
          }
          const foo = {
            name: "foo",
            base: "base-b",
            commands: [
              {
                name: "foo",
                description: "foo",
                handler: () => ({ result: {} }),
              },
              {
                name: "bar",
                description: "bar",
                handler: () => ({ result: {} }),
              },
            ],
          }

          const garden = await Garden.factory(path, {
            plugins: [baseA, baseB, foo],
            config: projectConfig,
          })

          const parsed = await garden.getPlugin("foo")

          expect(parsed.commands!.length).to.equal(2)

          const fooCommand = findByName(parsed.commands!, "foo")!
          const barCommand = findByName(parsed.commands!, "bar")!

          expect(fooCommand).to.exist
          expect(fooCommand.handler).to.equal(foo.commands[0].handler)
          expect(fooCommand.super).to.exist
          expect(fooCommand.super!.handler).to.equal(baseB.commands[0].handler)
          expect(fooCommand.super!.super).to.exist
          expect(fooCommand.super!.super!.handler).to.equal(baseA.commands[0].handler)
          expect(fooCommand.super!.super!.super).to.be.undefined

          expect(barCommand).to.exist
          expect(barCommand!.handler).to.equal(foo.commands[1].handler)
          expect(barCommand!.super).to.exist
          expect(barCommand!.super!.handler).to.equal(baseB.commands[1].handler)
          expect(barCommand!.super!.super).to.be.undefined
        })

        it("should combine defined module types from all plugins", async () => {
          const baseA: GardenPlugin = {
            name: "base-a",
            createModuleTypes: [
              {
                name: "a",
                docs: "foo",
                schema: joi.object(),
                handlers: {},
              },
            ],
          }
          const baseB: GardenPlugin = {
            name: "base-b",
            base: "base-a",
            createModuleTypes: [
              {
                name: "b",
                docs: "foo",
                schema: joi.object(),
                handlers: {},
              },
            ],
          }
          const foo: GardenPlugin = {
            name: "foo",
            base: "base-b",
            createModuleTypes: [
              {
                name: "c",
                docs: "bar",
                schema: joi.object(),
                handlers: {},
              },
            ],
          }

          const garden = await Garden.factory(path, {
            plugins: [baseA, baseB, foo],
            config: projectConfig,
          })

          const parsed = await garden.getPlugin("foo")

          expect(findByName(parsed.createModuleTypes || [], "a")!.name).to.equal("a")
          expect(findByName(parsed.createModuleTypes || [], "b")!.name).to.equal("b")
          expect(findByName(parsed.createModuleTypes || [], "c")!.name).to.equal("c")
        })

        it("should throw if attempting to redefine a module type defined in the base's base", async () => {
          const baseA: GardenPlugin = {
            name: "base-a",
            createModuleTypes: [
              {
                name: "foo",
                docs: "foo",
                schema: joi.object(),
                handlers: {},
              },
            ],
          }
          const baseB: GardenPlugin = {
            name: "base-b",
            base: "base-a",
            createModuleTypes: [],
          }
          const foo: GardenPlugin = {
            name: "foo",
            base: "base-b",
            createModuleTypes: [
              {
                name: "foo",
                docs: "foo",
                schema: joi.object(),
                handlers: {},
              },
            ],
          }

          const garden = await Garden.factory(path, {
            plugins: [baseA, baseB, foo],
            config: projectConfig,
          })

          await expectError(
            () => garden.getPlugins(),
            (err) => expect(err.message).to.equal(
              "Plugin 'foo' redeclares the 'foo' module type, already declared by its base.",
            ),
          )
        })

        it("should allow extending module types from the base's base", async () => {
          const baseA: GardenPlugin = {
            name: "base-a",
            createModuleTypes: [
              {
                name: "foo",
                docs: "foo",
                schema: joi.object(),
                handlers: {
                  configure: async ({ moduleConfig }) => ({ moduleConfig }),
                  build: async () => ({}),
                },
              },
            ],
          }
          const baseB: GardenPlugin = {
            name: "base-b",
            base: "base-a",
          }
          const foo: GardenPlugin = {
            name: "foo",
            base: "base-b",
            extendModuleTypes: [
              {
                name: "foo",
                handlers: {
                  build: async () => ({}),
                  getBuildStatus: async () => ({ ready: true }),
                },
              },
            ],
          }

          const garden = await Garden.factory(path, {
            plugins: [baseA, baseB, foo],
            config: projectConfig,
          })

          const parsed = await garden.getPlugin("foo")

          expect(findByName(parsed.createModuleTypes || [], "foo")).to.exist
          expect(findByName(parsed.extendModuleTypes || [], "foo")).to.exist
        })

        it("should coalesce module type extensions if base plugin is not configured", async () => {
          const baseA: GardenPlugin = {
            name: "base-a",
            createModuleTypes: [
              {
                name: "foo",
                docs: "foo",
                schema: joi.object(),
                handlers: {
                  configure: async ({ moduleConfig }) => ({ moduleConfig }),
                  build: async () => ({}),
                },
              },
            ],
          }
          const baseB: GardenPlugin = {
            name: "base-b",
            base: "base-a",
            extendModuleTypes: [
              {
                name: "foo",
                handlers: {
                  build: async () => ({}),
                },
              },
            ],
          }
          const baseC: GardenPlugin = {
            name: "base-c",
            base: "base-b",
            extendModuleTypes: [
              {
                name: "foo",
                handlers: {
                  build: async () => ({}),
                  getBuildStatus: async () => ({ ready: true }),
                },
              },
            ],
          }
          const foo: GardenPlugin = {
            name: "foo",
            base: "base-c",
          }

          const garden = await Garden.factory(path, {
            plugins: [baseA, baseB, baseC, foo],
            config: projectConfig,
          })

          const parsed = await garden.getPlugin("foo")

          expect(findByName(parsed.createModuleTypes || [], "foo")).to.exist

          // Module type extensions should be a combination of base-b and base-c extensions
          const fooExtension = findByName(parsed.extendModuleTypes || [], "foo")!

          expect(fooExtension).to.exist
          expect(fooExtension.handlers.build).to.exist
          expect(fooExtension.handlers.getBuildStatus).to.exist
          expect(fooExtension.handlers.build!.super).to.equal(baseB.extendModuleTypes![0].handlers!.build)
        })

        it("should throw if plugins have circular bases", async () => {
          const baseA = {
            name: "base-a",
            base: "foo",
          }
          const baseB = {
            name: "base-b",
            base: "base-a",
          }
          const foo = {
            name: "foo",
            base: "base-b",
          }

          const garden = await Garden.factory(path, {
            plugins: [baseA, baseB, foo],
            config: projectConfig,
          })

          await expectError(
            () => garden.getPlugins(),
            (err) => expect(err.message).to.equal(
              "One or more circular dependencies found between plugins and their bases: foo <- base-b <- base-a <- foo",
            ),
          )
        })
      })
    })
  })

  describe("resolveProviders", () => {
    it("should throw when when plugins are missing", async () => {
      const garden = await Garden.factory(projectRootA)
      await expectError(
        () => garden.resolveProviders(),
        (err) => expect(err.message).to.equal("Configured plugin 'test-plugin' has not been registered."),
      )
    })

    it("should pass through a basic provider config", async () => {
      const garden = await makeTestGardenA()
      const projectRoot = garden.projectRoot

      const testPluginProvider = {
        name: "test-plugin",
        config: {
          name: "test-plugin",
          environments: ["local"],
          path: projectRoot,
        },
        dependencies: [],
        moduleConfigs: [],
        status: {
          ready: true,
          outputs: {},
        },
      }

      expect(await garden.resolveProviders()).to.eql([
        emptyProvider(projectRoot, "exec"),
        emptyProvider(projectRoot, "container"),
        emptyProvider(projectRoot, "maven-container"),
        testPluginProvider,
        {
          name: "test-plugin-b",
          config: {
            name: "test-plugin-b",
            environments: ["local"],
            path: projectRoot,
          },
          dependencies: [testPluginProvider],
          moduleConfigs: [],
          status: {
            ready: true,
            outputs: {},
          },
        },
      ])
    })

    it("should call a configureProvider handler if applicable", async () => {
      const test = createGardenPlugin({
        name: "test",
        handlers: {
          async configureProvider({ config }: ConfigureProviderParams) {
            expect(config).to.eql({
              name: "test",
              path: projectRootA,
              foo: "bar",
            })
            return { config: { ...config, foo: "bla" } }
          },
        },
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test", foo: "bar" },
        ],
        variables: {},
      }

      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [test] })
      const provider = await garden.resolveProvider("test")

      expect(provider.config).to.eql({
        name: "test",
        path: projectRootA,
        foo: "bla",
      })
    })

    it("should give a readable error if provider configs have invalid template strings", async () => {
      const test = createGardenPlugin({
        name: "test",
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test", foo: "\${bla.ble}" },
        ],
        variables: {},
      }

      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [test] })
      await expectError(
        () => garden.resolveProviders(),
        err => expect(err.message).to.equal(
          "Failed resolving one or more providers:\n" +
          "- test: Invalid template string \${bla.ble}: Unable to resolve one or more keys.",
        ),
      )
    })

    it("should give a readable error if providers reference non-existent providers", async () => {
      const test = createGardenPlugin({
        name: "test",
        dependencies: ["foo"],
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test" },
        ],
        variables: {},
      }

      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [test] })
      await expectError(
        () => garden.resolveProviders(),
        err => expect(err.message).to.equal(
          "Missing provider dependency 'foo' in configuration for provider 'test'. " +
          "Are you missing a provider configuration?",
        ),
      )
    })

    it("should add plugin modules if returned by the provider", async () => {
      const pluginModule: ModuleConfig = {
        apiVersion: DEFAULT_API_VERSION,
        allowPublish: false,
        build: { dependencies: [] },
        name: "foo",
        outputs: {},
        path: "/tmp",
        serviceConfigs: [],
        taskConfigs: [],
        spec: {},
        testConfigs: [],
        type: "exec",
      }

      const test = createGardenPlugin({
        name: "test",
        handlers: {
          async configureProvider({ config }: ConfigureProviderParams) {
            return { config, moduleConfigs: [pluginModule] }
          },
        },
        createModuleTypes: [{
          name: "test",
          docs: "Test plugin",
          schema: joi.object(),
          handlers: {
            configure: async ({ moduleConfig }) => {
              return { moduleConfig }
            },
          },
        }],
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test", foo: "bar" },
        ],
        variables: {},
      }

      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [test] })

      const graph = await garden.getConfigGraph()
      expect(await graph.getModule("test--foo")).to.exist
    })

    it("should throw if plugins have declared circular dependencies", async () => {
      const testA = createGardenPlugin({
        name: "test-a",
        dependencies: ["test-b"],
      })

      const testB = createGardenPlugin({
        name: "test-b",
        dependencies: ["test-a"],
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test-a" },
          { name: "test-b" },
        ],
        variables: {},
      }

      const plugins = [testA, testB]
      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins })

      await expectError(
        () => garden.resolveProviders(),
        err => expect(err.message).to.equal(
          "One or more circular dependencies found between providers " +
          "or their configurations: test-a <- test-b <- test-a",
        ),
      )
    })

    it("should throw if plugins reference themselves as dependencies", async () => {
      const testA = createGardenPlugin({
        name: "test-a",
        dependencies: ["test-a"],
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test-a" },
        ],
        variables: {},
      }

      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [testA] })

      await expectError(
        () => garden.resolveProviders(),
        err => expect(err.message).to.equal(
          "One or more circular dependencies found between providers " +
          "or their configurations: test-a <- test-a",
        ),
      )
    })

    it("should throw if provider configs have implicit circular dependencies", async () => {
      const testA = createGardenPlugin({
        name: "test-a",
      })
      const testB = createGardenPlugin({
        name: "test-b",
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test-a", foo: "\${providers.test-b.outputs.foo}" },
          { name: "test-b", foo: "\${providers.test-a.outputs.foo}" },
        ],
        variables: {},
      }

      const plugins = [testA, testB]
      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins })

      await expectError(
        () => garden.resolveProviders(),
        err => expect(err.message).to.equal(
          "One or more circular dependencies found between providers " +
          "or their configurations: test-a <- test-b <- test-a",
        ),
      )
    })

    it("should throw if provider configs have combined implicit and declared circular dependencies", async () => {
      const testA = createGardenPlugin({
        name: "test-a",
      })

      const testB = createGardenPlugin({
        name: "test-b",
        dependencies: ["test-a"],
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test-a", foo: "\${providers.test-b.outputs.foo}" },
          { name: "test-b" },
        ],
        variables: {},
      }

      const plugins = [testA, testB]
      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins })

      await expectError(
        () => garden.resolveProviders(),
        err => expect(err.message).to.equal(
          "One or more circular dependencies found between providers " +
          "or their configurations: test-b <- test-a <- test-b",
        ),
      )
    })

    it("should apply default values from a plugin's configuration schema if specified", async () => {
      const test = createGardenPlugin({
        name: "test",
        configSchema: providerConfigBaseSchema
          .keys({
            foo: joi.string().default("bar"),
          }),
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test" },
        ],
        variables: {},
      }

      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [test] })
      const providers = keyBy(await garden.resolveProviders(), "name")

      expect(providers.test).to.exist
      expect(providers.test.config.foo).to.equal("bar")
    })

    it("should throw if a config doesn't match a plugin's configuration schema", async () => {
      const test = createGardenPlugin({
        name: "test",
        configSchema: providerConfigBaseSchema
          .keys({
            foo: joi.string(),
          }),
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test", foo: 123 },
        ],
        variables: {},
      }

      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [test] })

      await expectError(
        () => garden.resolveProviders(),
        err => expect(stripAnsi(err.message)).to.equal(
          "Failed resolving one or more providers:\n- " +
          "test: Error validating provider configuration (/garden.yml): key .foo must be a string",
        ),
      )
    })

    it("should throw if configureProvider returns a config that doesn't match a plugin's config schema", async () => {
      const test = createGardenPlugin({
        name: "test",
        configSchema: providerConfigBaseSchema
          .keys({
            foo: joi.string(),
          }),
        handlers: {
          configureProvider: async () => ({
            config: { name: "test", foo: 123 },
          }),
        },
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test" },
        ],
        variables: {},
      }

      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [test] })

      await expectError(
        () => garden.resolveProviders(),
        err => expect(stripAnsi(err.message)).to.equal(
          "Failed resolving one or more providers:\n- " +
          "test: Error validating provider configuration (/garden.yml): key .foo must be a string",
        ),
      )
    })

    it("should allow providers to reference each others' outputs", async () => {
      const testA = createGardenPlugin({
        name: "test-a",
        handlers: {
          getEnvironmentStatus: async () => {
            return {
              ready: true,
              outputs: { foo: "bar" },
            }
          },
        },
      })

      const testB = createGardenPlugin({
        name: "test-b",
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test-a" },
          { name: "test-b", foo: "\${providers.test-a.outputs.foo}" },
        ],
        variables: {},
      }

      const plugins = [testA, testB]
      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins })

      const providerB = await garden.resolveProvider("test-b")

      expect(providerB.config.foo).to.equal("bar")
    })

    it("should match a dependency to a plugin base", async () => {
      const baseA = createGardenPlugin({
        name: "base-a",
        handlers: {
          getEnvironmentStatus: async () => {
            return {
              ready: true,
              outputs: { foo: "bar" },
            }
          },
        },
      })

      const testA = createGardenPlugin({
        name: "test-a",
        base: "base-a",
      })

      const testB = createGardenPlugin({
        name: "test-b",
        dependencies: ["base-a"],
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test-a" },
          { name: "test-b" },
        ],
        variables: {},
      }

      const plugins = [baseA, testA, testB]
      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins })

      const providerA = await garden.resolveProvider("test-a")
      const providerB = await garden.resolveProvider("test-b")

      expect(providerB.dependencies).to.eql([providerA])
    })

    it("should match a dependency to a plugin base that's declared by multiple plugins", async () => {
      const baseA = createGardenPlugin({
        name: "base-a",
        handlers: {
          getEnvironmentStatus: async () => {
            return {
              ready: true,
              outputs: { foo: "bar" },
            }
          },
        },
      })

      // test-a and test-b share one base
      const testA = createGardenPlugin({
        name: "test-a",
        base: "base-a",
      })

      const testB = createGardenPlugin({
        name: "test-b",
        base: "base-a",
      })

      const testC = createGardenPlugin({
        name: "test-c",
        dependencies: ["base-a"],
      })

      const projectConfig: ProjectConfig = {
        apiVersion: "garden.io/v0",
        kind: "Project",
        name: "test",
        path: projectRootA,
        defaultEnvironment: "default",
        dotIgnoreFiles: defaultDotIgnoreFiles,
        environments: [
          { name: "default", variables: {} },
        ],
        providers: [
          { name: "test-a" },
          { name: "test-b" },
          { name: "test-c" },
        ],
        variables: {},
      }

      const plugins = [baseA, testA, testB, testC]
      const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins })

      const providerA = await garden.resolveProvider("test-a")
      const providerB = await garden.resolveProvider("test-b")
      const providerC = await garden.resolveProvider("test-c")

      expect(providerC.dependencies).to.eql([providerA, providerB])
    })

    context("when a plugin has a base", () => {
      it("should throw if the config for the plugin doesn't match the base's config schema", async () => {
        const base = createGardenPlugin({
          name: "base",
          configSchema: providerConfigBaseSchema
            .keys({
              foo: joi.string(),
            }),
        })

        const test = createGardenPlugin({
          name: "test",
          base: "base",
        })

        const projectConfig: ProjectConfig = {
          apiVersion: "garden.io/v0",
          kind: "Project",
          name: "test",
          path: projectRootA,
          defaultEnvironment: "default",
          dotIgnoreFiles: defaultDotIgnoreFiles,
          environments: [
            { name: "default", variables: {} },
          ],
          providers: [
            { name: "test", foo: 123 },
          ],
          variables: {},
        }

        const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [base, test] })

        await expectError(
          () => garden.resolveProviders(),
          err => expect(stripAnsi(err.message)).to.equal(
            "Failed resolving one or more providers:\n" +
            "- test: Error validating provider configuration (base schema from 'base' plugin) " +
            "(/garden.yml): key .foo must be a string",
          ),
        )
      })

      it("should throw if the configureProvider handler doesn't return a config matching the base", async () => {
        const base = createGardenPlugin({
          name: "base",
          configSchema: providerConfigBaseSchema
            .keys({
              foo: joi.string(),
            }),
        })

        const test = createGardenPlugin({
          name: "test",
          base: "base",
          handlers: {
            configureProvider: async () => ({
              config: { name: "test", foo: 123 },
            }),
          },
        })

        const projectConfig: ProjectConfig = {
          apiVersion: "garden.io/v0",
          kind: "Project",
          name: "test",
          path: projectRootA,
          defaultEnvironment: "default",
          dotIgnoreFiles: defaultDotIgnoreFiles,
          environments: [
            { name: "default", variables: {} },
          ],
          providers: [
            { name: "test" },
          ],
          variables: {},
        }

        const garden = await TestGarden.factory(projectRootA, { config: projectConfig, plugins: [base, test] })

        await expectError(
          () => garden.resolveProviders(),
          err => expect(stripAnsi(err.message)).to.equal(
            "Failed resolving one or more providers:\n" +
            "- test: Error validating provider configuration (base schema from 'base' plugin) " +
            "(/garden.yml): key .foo must be a string",
          ),
        )
      })
    })
  })

  describe("scanForConfigs", () => {
    it("should find all garden configs in the project directory", async () => {
      const garden = await makeTestGardenA()
      const files = await garden.scanForConfigs(garden.projectRoot)
      expect(files).to.eql([
        join(garden.projectRoot, "garden.yml"),
        join(garden.projectRoot, "module-a", "garden.yml"),
        join(garden.projectRoot, "module-b", "garden.yml"),
        join(garden.projectRoot, "module-c", "garden.yml"),
      ])
    })

    it("should respect the include option, if specified", async () => {
      const garden = await makeTestGardenA()
      set(garden, "moduleIncludePatterns", ["module-a/**/*"])
      const files = await garden.scanForConfigs(garden.projectRoot)
      expect(files).to.eql([
        join(garden.projectRoot, "module-a", "garden.yml"),
      ])
    })

    it("should respect the exclude option, if specified", async () => {
      const garden = await makeTestGardenA()
      set(garden, "moduleExcludePatterns", ["module-a/**/*"])
      const files = await garden.scanForConfigs(garden.projectRoot)
      expect(files).to.eql([
        join(garden.projectRoot, "garden.yml"),
        join(garden.projectRoot, "module-b", "garden.yml"),
        join(garden.projectRoot, "module-c", "garden.yml"),
      ])
    })

    it("should respect the include and exclude options, if both are specified", async () => {
      const garden = await makeTestGardenA()
      set(garden, "moduleIncludePatterns", ["module*/**/*"])
      set(garden, "moduleExcludePatterns", ["module-a/**/*"])
      const files = await garden.scanForConfigs(garden.projectRoot)
      expect(files).to.eql([
        join(garden.projectRoot, "module-b", "garden.yml"),
        join(garden.projectRoot, "module-c", "garden.yml"),
      ])
    })
  })

  describe("scanModules", () => {
    // TODO: assert that gitignore in project root is respected
    it("should scan the project root for modules and add to the context", async () => {
      const garden = await makeTestGardenA()
      await garden.scanModules()

      const modules = await garden.resolveModuleConfigs()
      expect(getNames(modules).sort()).to.eql(["module-a", "module-b", "module-c"])
    })

    it("should scan and add modules for projects with configs defining multiple modules", async () => {
      const garden = await makeTestGarden(resolve(dataDir, "test-projects", "multiple-module-config"))
      await garden.scanModules()

      const modules = await garden.resolveModuleConfigs()
      expect(getNames(modules).sort()).to.eql([
        "module-a1",
        "module-a2",
        "module-b1",
        "module-b2",
        "module-c",
        "module-from-project-config",
      ])
    })

    it("should scan and add modules for projects with external project sources", async () => {
      const garden = await makeExtProjectSourcesGarden()
      await garden.scanModules()
      const modules = await garden.resolveModuleConfigs()
      expect(getNames(modules).sort()).to.eql(["module-a", "module-b", "module-c"])
    })

    it("should throw when two modules have the same name", async () => {
      const garden = await makeTestGarden(resolve(dataDir, "test-projects", "duplicate-module"))

      await expectError(
        () => garden.scanModules(),
        err => expect(err.message).to.equal(
          "Module module-a is declared multiple times (in 'module-a/garden.yml' and 'module-b/garden.yml')",
        ),
      )
    })

    it("should scan and add modules with config files with yaml and yml extensions", async () => {
      const garden = await makeTestGarden(getDataDir("test-project-yaml-file-extensions"))
      const modules = await garden.resolveModuleConfigs()
      expect(getNames(modules).sort()).to.eql(["module-yaml", "module-yml"])
    })

    it("should respect the modules.include and modules.exclude fields, if specified", async () => {
      const projectRoot = getDataDir("test-projects", "project-include-exclude")
      const garden = await makeTestGarden(projectRoot)
      const moduleConfigs = await garden.resolveModuleConfigs()

      // Should NOT include "nope" and "module-c"
      expect(getNames(moduleConfigs).sort()).to.eql(["module-a", "module-b"])
    })

    it("should respect .gitignore and .gardenignore files", async () => {
      const projectRoot = getDataDir("test-projects", "dotignore")
      const garden = await makeTestGarden(projectRoot)
      const moduleConfigs = await garden.resolveModuleConfigs()

      expect(getNames(moduleConfigs).sort()).to.eql(["module-a"])
    })

    it("should respect custom dotignore files", async () => {
      const projectRoot = getDataDir("test-projects", "dotignore")
      const garden = await makeTestGarden(projectRoot)
      const moduleConfigs = await garden.resolveModuleConfigs()

      expect(getNames(moduleConfigs).sort()).to.eql(["module-a"])
    })
  })

  describe("loadModuleConfigs", () => {
    it("should resolve module by absolute path", async () => {
      const garden = await makeTestGardenA()
      const path = join(projectRootA, "module-a")

      const module = (await (<any>garden).loadModuleConfigs(path))[0]
      expect(module!.name).to.equal("module-a")
    })

    it("should resolve module by relative path to project root", async () => {
      const garden = await makeTestGardenA()

      const module = (await (<any>garden).loadModuleConfigs("./module-a"))[0]
      expect(module!.name).to.equal("module-a")
    })
  })

  describe("resolveModuleConfigs", () => {
    it("should throw if a module references itself in a template string", async () => {
      const projectRoot = resolve(dataDir, "test-projects", "module-self-ref")
      const garden = await makeTestGarden(projectRoot)
      await expectError(
        () => garden.resolveModuleConfigs(),
        (err) => expect(err.message).to.equal(
          "Invalid template string \${modules.module-a.version}: " +
          "Circular reference detected when resolving key modules.module-a (from modules.module-a)",
        ),
      )
    })

    it("should resolve module path to external sources dir if module has a remote source", async () => {
      const projectRoot = resolve(dataDir, "test-project-ext-module-sources")
      const garden = await makeExtModuleSourcesGarden()

      const module = await garden.resolveModuleConfig("module-a")

      expect(module!.path).to.equal(join(projectRoot, ".garden", "sources", "module", `module-a--${testGitUrlHash}`))
    })

    it("should handle template variables for non-string fields", async () => {
      const projectRoot = getDataDir("test-projects", "non-string-template-values")
      const garden = await makeTestGarden(projectRoot)

      const module = await garden.resolveModuleConfig("module-a")

      // We template in the value for the module's allowPublish field to test this
      expect(module.allowPublish).to.equal(false)
    })

    it("should handle module references within single file", async () => {
      const projectRoot = getDataDir("test-projects", "1067-module-ref-within-file")
      const garden = await makeTestGarden(projectRoot)
      // This should just complete successfully
      await garden.resolveModuleConfigs()
    })

    it("should throw if a module type is not recognized", async () => {
      const garden = await makeTestGardenA()
      const config = (await garden.getRawModuleConfigs(["module-a"]))[0]

      config.type = "foo"

      await expectError(
        () => garden.resolveModuleConfigs(),
        (err) => expect(err.message).to.equal(
          "Unrecognized module type 'foo' (defined at module-a/garden.yml). Are you missing a provider configuration?",
        ),
      )
    })
  })

  describe("resolveVersion", () => {
    beforeEach(() => td.reset())

    it("should return result from cache if available", async () => {
      const garden = await makeTestGardenA()
      const module = await garden.resolveModuleConfig("module-a")
      const version: ModuleVersion = {
        versionString: "banana",
        dependencyVersions: {},
        files: [],
      }
      garden.cache.set(["moduleVersions", module.name], version, getModuleCacheContext(module))

      const result = await garden.resolveVersion("module-a", [])

      expect(result).to.eql(version)
    })

    it("should otherwise return version from VCS handler", async () => {
      const garden = await makeTestGardenA()
      await garden.scanModules()

      garden.cache.delete(["moduleVersions", "module-b"])

      const resolveStub = td.replace(garden.vcs, "resolveVersion")
      const version: ModuleVersion = {
        versionString: "banana",
        dependencyVersions: {},
        files: [],
      }

      td.when(resolveStub(), { ignoreExtraArgs: true }).thenResolve(version)

      const result = await garden.resolveVersion("module-b", [])

      expect(result).to.eql(version)
    })

    it("should ignore cache if force=true", async () => {
      const garden = await makeTestGardenA()
      const module = await garden.resolveModuleConfig("module-a")
      const version: ModuleVersion = {
        versionString: "banana",
        dependencyVersions: {},
        files: [],
      }
      garden.cache.set(["moduleVersions", module.name], version, getModuleCacheContext(module))

      const result = await garden.resolveVersion("module-a", [], true)

      expect(result).to.not.eql(version)
    })
  })

  describe("loadExtSourcePath", () => {
    let garden: TestGarden

    context("external project sources", () => {
      before(async () => {
        garden = await makeExtProjectSourcesGarden()
      })

      afterEach(async () => {
        await resetLocalConfig(garden.gardenDirPath)
      })

      it("should return the path to the project source if source type is project", async () => {
        const projectRoot = getDataDir("test-project-ext-project-sources")
        const path = await garden.loadExtSourcePath({
          repositoryUrl: testGitUrl,
          name: "source-a",
          sourceType: "project",
        })
        expect(path).to.equal(join(projectRoot, ".garden", "sources", "project", `source-a--${testGitUrlHash}`))
      })

      it("should return the local path of the project source if linked", async () => {
        const localProjectSourceDir = getDataDir("test-project-local-project-sources")
        const linkedSourcePath = join(localProjectSourceDir, "source-a")

        const linked: LinkedSource[] = [{
          name: "source-a",
          path: linkedSourcePath,
        }]
        await garden.configStore.set(["linkedProjectSources"], linked)

        const path = await garden.loadExtSourcePath({
          name: "source-a",
          repositoryUrl: testGitUrl,
          sourceType: "project",
        })

        expect(path).to.equal(linkedSourcePath)
      })
    })

    context("external module sources", () => {
      before(async () => {
        garden = await makeExtModuleSourcesGarden()
      })

      afterEach(async () => {
        await resetLocalConfig(garden.gardenDirPath)
      })

      it("should return the path to the module source if source type is module", async () => {
        const projectRoot = getDataDir("test-project-ext-module-sources")
        const path = await garden.loadExtSourcePath({
          repositoryUrl: testGitUrl,
          name: "module-a",
          sourceType: "module",
        })
        expect(path).to.equal(join(projectRoot, ".garden", "sources", "module", `module-a--${testGitUrlHash}`))
      })

      it("should return the local path of the module source if linked", async () => {
        const localModuleSourceDir = getDataDir("test-project-local-module-sources")
        const linkedModulePath = join(localModuleSourceDir, "module-a")

        const linked: LinkedSource[] = [{
          name: "module-a",
          path: linkedModulePath,
        }]
        await garden.configStore.set(["linkedModuleSources"], linked)

        const path = await garden.loadExtSourcePath({
          name: "module-a",
          repositoryUrl: testGitUrl,
          sourceType: "module",
        })

        expect(path).to.equal(linkedModulePath)
      })
    })
  })
})

function emptyProvider(projectRoot: string, name: string) {
  return {
    name,
    config: {
      name,
      path: projectRoot,
    },
    dependencies: [],
    moduleConfigs: [],
    status: {
      ready: true,
      outputs: {},
    },
  }
}
