param(
  [string]$Root = (Resolve-Path ".."),
  [string[]]$Include = @("*.json","*.mjs","*.js","*.ts","*.tsx")
)
$targets = Get-ChildItem $Root -Recurse -File -Include $Include
$utf8NoBom = [Text.UTF8Encoding]::new($false)
$fixed = 0
foreach($f in $targets){
  $bytes = [IO.File]::ReadAllBytes($f.FullName)
  $start = 0
  if($bytes.Length -ge 3 -and $bytes[0]-eq0xEF -and $bytes[1]-eq0xBB -and $bytes[2]-eq0xBF){ $start = 3 }
  $text = [Text.Encoding]::UTF8.GetString($bytes[$start..($bytes.Length-1)])
  $clean = $text -replace "^\uFEFF","" -replace "[\uFEFF\u200B\u200C\u200D]",""
  if($clean -ne $text -or $start -eq 3){
    [IO.File]::WriteAllText($f.FullName,$clean,$utf8NoBom)
    Write-Host "Fixed: $($f.FullName)"
    $fixed++
  }
}
Write-Host "Done. Fixed files: $fixed"
