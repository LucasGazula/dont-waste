$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Don't Waste requires Node.js 22 or newer."
}

$major = [int]((node -p "process.versions.node.split('.')[0]"))
if ($major -lt 22) {
  throw "Don't Waste requires Node.js 22 or newer (found $(node --version))."
}

npm install --global dont-waste@latest
dont-waste init @args
