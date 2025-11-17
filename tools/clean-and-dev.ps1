param([int]$Port = 3000,[switch]$Fresh)
if(Test-Path ".next"){ Remove-Item ".next" -Recurse -Force }
$procs = Get-Process node,npm -ErrorAction SilentlyContinue
if($procs){ $procs | Stop-Process -Force; Start-Sleep -Milliseconds 300 }
if($Fresh){
  if(Test-Path "package-lock.json"){ Remove-Item "package-lock.json" -Force }
  if(Test-Path "node_modules"){ Remove-Item "node_modules" -Recurse -Force }
  npm ci
}
npm run dev
