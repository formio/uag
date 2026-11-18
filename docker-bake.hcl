variable "VERSION" { default = "dev" }
variable "CHANNEL" { default = "dev" }
variable "REGISTRIES" { default = "" }

function "tags" {
  params = [name]
  result = flatten([for r in split(",", REGISTRIES) : [
    "${r}formio/${name}:${VERSION}",
    "${r}formio/${name}:${CHANNEL}",
  ]])
}

group "default" {
  targets = [
    "uag",
    "uag-engines",
  ]
}

target "_common" {
  context   = "."
  platforms = ["linux/amd64", "linux/arm64"]
}

target "uag" {
  inherits = ["_common"]
  tags     = tags("uag")
}

target "uag-engines" {
  inherits   = ["_common"]
  dockerfile = "packages/engine-server/Dockerfile"
  tags       = tags("uag-engines")
}
