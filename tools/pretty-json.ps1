param([string[]]$Files = @("package.json","tsconfig.json"))
foreach($name in $Files){
  if(Test-Path $name){
    try{
      $obj = Get-Content -Raw -LiteralPath $name | ConvertFrom-Json
      $pretty = $obj | ConvertTo-Json -Depth 100 -Compress:$false
      Set-Content -LiteralPath $name -Value $pretty -Encoding UTF8
      Write-Host "Pretty JSON: $name"
    }catch{
      Write-Error "Invalid JSON: $name"
      exit 1
    }
  }
}
