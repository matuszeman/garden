# Local Exec (Executing local commands with Garden)

> Note: You need to have Go installed to run this project.

This example project demonstrates how you can use the `exec` module type to run build commands, tasks and tests in the module directory, by setting `local: true` in the module config. By default the commands are executed in the `.garden/build` directory.

The idea is to use a local exec module to run pre-build commands for a container module.

## Project Structure

The project consists of a `local-executor` module, a `builder` module, and a `backend` module.

The `local-executor` module has a task called `local-task` that just prints the current directory. You'll notice that it's the directory that the module is in, not the Garden build directory.

The `backend` and `builder` modules are in the same `garden.yml` file in the `backend` directory.

The `backend` module is a simple `container` module that acts as a web server written in Go. The corresponding Dockerfile expects the web server binary to already be built before adding it to the image (note that this is only for demonstration purposes and not a recommended pattern for Go binaries).

To achieve this, we add a `go build` command to the `builder` module, set `local: true`, and then declare it as a build dependency in the `backend` module.

This ensures that Garden runs `go build` in the module directory before it attempts to build the Docker image for the `backend` module.

## Usage

Run `garden run task local-task` to print the name of the module directory itself, as opposed to the Garden build directory which is the default if `local` is not set to `true`.

Run `garden deploy` to deploy the project. You'll notice that Garden first builds the Go binary, before it's added to the container image.
