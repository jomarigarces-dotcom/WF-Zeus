# build.ps1 - Run from Transition folder to finalize index.html and app.js
$SRC = "$PSScriptRoot\..\Appscript"
$OUT = $PSScriptRoot

#--- 1. Build index.html from Appscript\index.html ---
$lines = Get-Content "$SRC\index.html"
$result = [System.Collections.Generic.List[string]]::new()
$skip = $false
foreach ($line in $lines) {
    # Remove AppScript CSS include
    if ($line -match "\<\?!=\s*include\('CSS'\)") { continue }
    # Remove AppScript JS include + importmap (handled separately below)
    if ($line -match "\<\?!=\s*include\('JS'\)") { continue }
    # Remove importmap script block start
    if ($line -match '<script type="importmap">') { $skip = $true; continue }
    # Remove AI bot widget container
    if ($line -match '<!-- AI BOT WIDGET STRUCTURE -->') { $skip = $true; continue }
    # End skip on Org Chart Modal comment (after AI bot block)
    if ($skip -and $line -match '<!-- Org Chart Modal -->') {
        $skip = $false
        $result.Add($line)
        continue
    }
    # End skip on importmap closing
    if ($skip -and $line -match '</script>') { $skip = $false; continue }
    if ($skip) { continue }
    $result.Add($line)
}
# Inject app.js script before </body>
$final = [System.Collections.Generic.List[string]]::new()
foreach ($line in $result) {
    if ($line -match '</body>') {
        $final.Add('  <script type="module" src="app.js"></script>')
    }
    $final.Add($line)
}
$final | Out-File "$OUT\index.html" -Encoding UTF8
Write-Host "index.html written ($($final.Count) lines)"

#--- 2. Build app.js from Appscript\JS.html ---
$jsLines = Get-Content "$SRC\JS.html"
$jsOut = [System.Collections.Generic.List[string]]::new()
$jsSkip = $false
# Header comment
$jsOut.Add("/**")
$jsOut.Add(" * app.js - WF Zeus Transition Frontend")
$jsOut.Add(" * Adapted from JS.html. Replace google.script.run calls with Convex calls.")
$jsOut.Add(" * Import the Convex API functions from convex-client.js and _generated/api.js")
$jsOut.Add(" */")
$jsOut.Add("import { convex, runQuery, runMutation } from './convex-client.js';")
$jsOut.Add("")
$jsOut.Add("// NOTE: Replace google.script.run.withSuccessHandler(cb).methodName(args) with:")
$jsOut.Add("//   convex.query(api.module.functionName, args).then(cb)   -- for queries")
$jsOut.Add("//   convex.mutation(api.module.functionName, args).then(cb) -- for mutations")
$jsOut.Add("")

foreach ($line in $jsLines) {
    # Strip outer <script> tags
    if ($line -match '^\s*<script') { continue }
    if ($line -match '^\s*</script>') { continue }
    # Skip AI bot section
    if ($line -match '// --- AI BOT LOGIC ---') { $jsSkip = $true }
    if ($jsSkip) {
        # End of file = end of AI bot section
        continue
    }
    # Annotate google.script.run calls for easy find/replace
    if ($line -match 'google\.script\.run') {
        $jsOut.Add("    // TODO-CONVEX: Replace google.script.run call below with Convex mutation/query")
    }
    $jsOut.Add($line)
}

$jsOut | Out-File "$OUT\app.js" -Encoding UTF8
Write-Host "app.js written ($($jsOut.Count) lines)"
Write-Host "Build complete!"
