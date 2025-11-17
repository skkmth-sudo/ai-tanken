param([switch]$NoDev,[switch]$Detach)
& "$PSScriptRoot\fix-bom.ps1" -Root (Resolve-Path "..")
& "$PSScriptRoot\pretty-json.ps1" -Files @("package.json","tsconfig.json")
if ($NoDev) { return }
if ($Detach) {
  $root = (Resolve-Path "..").Path
  Start-Process pwsh -ArgumentList @('-NoExit','-Command',"Set-Location `"$root`"; npm run dev")
} else {
  & "$PSScriptRoot\clean-and-dev.ps1"
}
