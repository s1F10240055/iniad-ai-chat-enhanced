$ErrorActionPreference = "Stop"

# Node/Electron writes UTF-8. Keep PowerShell and the Windows console on the
# same encoding so Japanese diagnostics are not decoded as the legacy code page.
chcp 65001 | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

& npm run start
exit $LASTEXITCODE
