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
    # "uag-demo",
    # "uag-demo-maint",
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

# target "uag-demo" {
#   inherits   = ["_common"]
#   dockerfile = "demo/Dockerfile.demo"
#   tags       = tags("uag-demo")
# }
#
# target "uag-demo-maint" {
#   inherits   = ["_common"]
#   dockerfile = "demo/Dockerfile.maint"
#   tags       = tags("uag-demo-maint")
# }
