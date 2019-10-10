import { expect } from "chai"
import { TestCommand } from "../../../../src/commands/test"
import isSubset = require("is-subset")
import { makeTestGardenA, taskResultOutputs, withDefaultGlobalOpts } from "../../../helpers"

describe("commands.test", () => {
  it("should run all tests in a simple project", async () => {
    const garden = await makeTestGardenA()
    const log = garden.log
    const command = new TestCommand()

    const { result } = await command.action({
      garden,
      log,
      headerLog: log,
      footerLog: log,
      args: { modules: undefined },
      opts: withDefaultGlobalOpts({ "name": undefined, "force": true, "force-build": true, "watch": false }),
    })

    expect(isSubset(taskResultOutputs(result!), {
      "build.module-a": {
        fresh: true,
        buildLog: "A\n",
      },
      "test.module-a.unit": {
        success: true,
        log: "OK\n",
      },
      "build.module-b": {
        fresh: true,
        buildLog: "B\n",
      },
      "build.module-c": {},
      "test.module-b.unit": {
        success: true,
        log: "OK\n",
      },
      "test.module-c.unit": {
        success: true,
        log: "OK\n",
      },
    })).to.be.true
  })

  it("should optionally test single module", async () => {
    const garden = await makeTestGardenA()
    const log = garden.log
    const command = new TestCommand()

    const { result } = await command.action({
      garden,
      log,
      headerLog: log,
      footerLog: log,
      args: { modules: ["module-a"] },
      opts: withDefaultGlobalOpts({ "name": undefined, "force": true, "force-build": true, "watch": false }),
    })

    expect(isSubset(taskResultOutputs(result!), {
      "build.module-a": {
        fresh: true,
        buildLog: "A\n",
      },
      "test.module-a.unit": {
        success: true,
        log: "OK\n",
      },
    })).to.be.true
  })

  it("should only run integration tests if the option 'name' is specified with a glob", async () => {
    const garden = await makeTestGardenA()
    const log = garden.log
    const command = new TestCommand()

    const { result } = await command.action({
      garden,
      log,
      headerLog: log,
      footerLog: log,
      args: { modules: ["module-a"] },
      opts: withDefaultGlobalOpts({ "name": "int*", "force": true, "force-build": true, "watch": false }),
    })

    expect(isSubset(taskResultOutputs(result!), {
      "build.module-a": {
        fresh: true,
        buildLog: "A\n",
      },
      "test.module-a.integration": {
        success: true,
        log: "OK\n",
      },
      "test.module-c.integ": {
        success: true,
        log: "OK\n",
      },
    })).to.be.true

    expect(isSubset(taskResultOutputs(result!), {
      "test.module-a.unit": {
        success: true,
        log: "OK\n",
      },
      "test.module-c.unit": {
        success: true,
        log: "OK\n",
      },
    })).to.be.false
  })
})
