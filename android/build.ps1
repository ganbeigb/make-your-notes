# build.ps1 - build the phone-local APK (web app + embedded Node.js runtime).
#
# The project folder has a Chinese name and aapt2 cannot handle non-ASCII argv paths,
# so everything is staged into a temporary ASCII directory, built there, and the final
# APK is copied back next to the web app.
#
# Pipeline:
#   payload   -> assets/app.zip  (server/ + public/)
#   NDK/clang -> libcoursenotes_node.so (JNI glue calling node::Start)
#   aapt2     -> resources + manifest + R.java
#   javac+d8  -> classes.dex
#   zip update-> classes.dex + lib/arm64-v8a/*.so
#   zipalign + apksigner -> 课件知识助手.apk
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1

$ErrorActionPreference = 'Stop'
$Src = $PSScriptRoot
$App = Split-Path $Src -Parent
$Work = Join-Path $env:TEMP 'coursenotes-apk-build'

$Jdk   = 'D:\dshwork\tools\jdk21'
$Sdk   = 'D:\dshwork\tools\android-sdk'
$Ndk   = Join-Path $Sdk 'ndk\29.0.14206865'
$Njm   = 'D:\dshwork\nodejs-mobile'
$Bt    = Join-Path $Sdk 'build-tools\35.0.0'
$AndroidJar = Join-Path $Sdk 'platforms\android-35\android.jar'

$Javac   = Join-Path $Jdk 'bin\javac.exe'
$Jar     = Join-Path $Jdk 'bin\jar.exe'
$Keytool = Join-Path $Jdk 'bin\keytool.exe'
$Aapt2   = Join-Path $Bt 'aapt2.exe'
$D8      = Join-Path $Bt 'd8.bat'
$ZipAl   = Join-Path $Bt 'zipalign.exe'
$ApkSign = Join-Path $Bt 'apksigner.bat'
$Clang   = Join-Path $Ndk 'toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android24-clang++.cmd'
$Sysroot = Join-Path $Ndk 'toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib\aarch64-linux-android'

$env:JAVA_HOME = $Jdk
$env:PATH = (Join-Path $Jdk 'bin') + ';' + (Join-Path $Ndk 'toolchains\llvm\prebuilt\windows-x86_64\bin') + ';' + $env:PATH

$Build    = Join-Path $Work 'build'
$Gen      = Join-Path $Build 'gen'
$Classes  = Join-Path $Build 'classes'
$Dex      = Join-Path $Build 'dex'
$LibOut   = Join-Path $Build 'lib\arm64-v8a'
$Stage    = Join-Path $Build 'stage'
$PayloadStage = Join-Path $Build 'payload'
$KeystoreProject = Join-Path $Src 'coursenotes.keystore'
$Keystore = Join-Path $Build 'coursenotes.keystore'
$StorePass = 'coursenotes'; $KeyPass = 'coursenotes'; $Alias = 'coursenotes'
$MinSdk = 24; $TargetSdk = 35; $VersionCode = 82; $VersionName = '2.9.9'
$Abi = 'arm64-v8a'
$Assets = Join-Path $Work 'assets'
$Payload = Join-Path $Assets 'app.zip'
$FinalApk = Join-Path $Build 'CourseNotes.apk'
$Deliverable = Join-Path $App ("MakeYourNotes-v" + $VersionName + ".apk")

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Need($p, $w) { if (-not (Test-Path $p)) { throw "$w not found: $p" } }
function Check($w) { if ($LASTEXITCODE -ne 0) { throw "$w failed (exit $LASTEXITCODE)" } }

Step 'checking the toolchain'
foreach ($p in @($Javac, $Jar, $Keytool, $Aapt2, $D8, $ZipAl, $ApkSign, $Clang, $AndroidJar)) {
  Need $p 'required tool'
}
Need (Join-Path $Njm 'arm64-libnode.so') 'arm64 libnode.so'
Need (Join-Path $Njm 'include\node\node.h') 'node headers'
Need (Join-Path $Sysroot 'libc++_shared.so') 'libc++_shared.so'

Step "staging sources into $Work"
if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }
foreach ($d in @($Gen, $Classes, $Dex, $LibOut, $Stage, $PayloadStage, $Assets)) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
Copy-Item (Join-Path $Src 'src') (Join-Path $Work 'src') -Recurse
Copy-Item (Join-Path $Src 'res') (Join-Path $Work 'res') -Recurse
Copy-Item (Join-Path $Src 'jni') (Join-Path $Work 'jni') -Recurse
Copy-Item (Join-Path $Src 'AndroidManifest.xml') (Join-Path $Work 'AndroidManifest.xml') -Force

Step 'staging the web payload (server + public)'
Copy-Item (Join-Path $App 'server') (Join-Path $PayloadStage 'server') -Recurse
Copy-Item (Join-Path $App 'public') (Join-Path $PayloadStage 'public') -Recurse
Get-ChildItem (Join-Path $Src 'assets') -File | Copy-Item -Destination $Assets -Force
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $Payload) { Remove-Item $Payload -Force }
$fs = [System.IO.File]::Open($Payload, [System.IO.FileMode]::CreateNew)
$zipOut = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$baseLen = (Resolve-Path $PayloadStage).Path.TrimEnd('\').Length + 1
Get-ChildItem $PayloadStage -Recurse -File | ForEach-Object {
  # .NET Framework 的 CreateFromDirectory 会写成反斜杠，Android 上会变成文件名的一部分；这里强制用 '/'
  $rel = $_.FullName.Substring($baseLen).Replace('\', '/')
  $entry = $zipOut.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
  $es = $entry.Open()
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
  $es.Write($bytes, 0, $bytes.Length)
  $es.Dispose()
}
$zipOut.Dispose()
$fs.Dispose()
Write-Host "  app.zip $([math]::Round((Get-Item $Payload).Length/1MB,2)) MB"

Step "staging native libraries ($Abi)"
Copy-Item (Join-Path $Njm 'arm64-libnode.so') (Join-Path $Stage 'libnode.so') -Force
Copy-Item (Join-Path $Sysroot 'libc++_shared.so') (Join-Path $Stage 'libc++_shared.so') -Force
Write-Host "  libnode.so $([math]::Round((Get-Item (Join-Path $Stage 'libnode.so')).Length/1MB,1)) MB"

Step 'compiling the JNI glue (NDK/clang++)'
$glue = Join-Path $LibOut 'libcoursenotes_node.so'
& $Clang -shared -fPIC -O2 -fvisibility=hidden `
  -o $glue `
  (Join-Path $Work 'jni\node_bridge.cpp') `
  "-I$(Join-Path $Njm 'include\node')" `
  "-L$Stage" -lnode -llog -landroid
Check 'clang++'
Write-Host "  libcoursenotes_node.so $([math]::Round((Get-Item $glue).Length/1KB,1)) KB"

Copy-Item (Join-Path $Stage 'libnode.so') $LibOut -Force
Copy-Item (Join-Path $Stage 'libc++_shared.so') $LibOut -Force

Step 'aapt2 compile (resources)'
$resZip = Join-Path $Build 'res.zip'
& $Aapt2 compile --dir (Join-Path $Work 'res') -o $resZip
Check 'aapt2 compile'

Step 'aapt2 link (resources + manifest + assets)'
$baseApk = Join-Path $Build 'base.apk'
& $Aapt2 link -o $baseApk `
  -I $AndroidJar `
  --manifest (Join-Path $Work 'AndroidManifest.xml') `
  --java $Gen `
  -A $Assets `
  --min-sdk-version $MinSdk --target-sdk-version $TargetSdk `
  --version-code $VersionCode --version-name $VersionName `
  $resZip
Check 'aapt2 link'
Write-Host "  base.apk $([math]::Round((Get-Item $baseApk).Length/1MB,1)) MB"

Step 'javac'
$sources = @()
$sources += Get-ChildItem $Gen -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
$sources += Get-ChildItem (Join-Path $Work 'src') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
Write-Host "  $($sources.Count) source file(s)"
& $Javac -encoding UTF-8 --release 11 -nowarn -cp $AndroidJar -d $Classes @sources
Check 'javac'

Step 'd8'
$classJar = Join-Path $Build 'classes.jar'
& $Jar cf $classJar -C $Classes .
Check 'jar'
& $D8 --release --min-api $MinSdk --lib $AndroidJar --output $Dex $classJar
Check 'd8'
$dexFile = Join-Path $Dex 'classes.dex'
Need $dexFile 'classes.dex'

Step 'packing dex + native libraries into the APK'
$zip = [System.IO.Compression.ZipFile]::Open($baseApk, 'Update')
function Add-OrReplace($zip, $path, $entryName, $level) {
  foreach ($e in @($zip.Entries | Where-Object { $_.FullName -eq $entryName })) { $e.Delete() }
  [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $path, $entryName, $level)
}
Add-OrReplace $zip $dexFile 'classes.dex' ([System.IO.Compression.CompressionLevel]::Optimal)
foreach ($so in (Get-ChildItem $LibOut -File)) {
  Add-OrReplace $zip $so.FullName "lib/$Abi/$($so.Name)" ([System.IO.Compression.CompressionLevel]::Optimal)
  Write-Host "  + lib/$Abi/$($so.Name)"
}
$zip.Dispose()

Step 'zipalign'
$alignedApk = Join-Path $Build 'aligned.apk'
& $ZipAl -f -p 4 $baseApk $alignedApk
Check 'zipalign'

Step 'signing key'
if (Test-Path $KeystoreProject) {
  Copy-Item $KeystoreProject $Keystore -Force
  Write-Host '  reusing the keystore from the project'
} else {
  Write-Host '  generating a self-signed key (10000 days)'
  & $Keytool -genkeypair -v -keystore $Keystore -alias $Alias `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $StorePass -keypass $KeyPass `
    -dname 'CN=Course Notes, OU=personal, O=personal, L=Wenzhou, ST=Zhejiang, C=CN'
  Check 'keytool'
  Copy-Item $Keystore $KeystoreProject -Force
}

Step 'apksigner sign'
& $ApkSign sign --ks $Keystore --ks-key-alias $Alias `
  --ks-pass "pass:$StorePass" --key-pass "pass:$KeyPass" `
  --min-sdk-version $MinSdk `
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true `
  --out $FinalApk $alignedApk
Check 'apksigner sign'

Step 'verify'
$verifyOut = & $ApkSign verify --print-certs $FinalApk 2>&1
Check 'apksigner verify'
$verifyOut | Select-Object -First 3 | ForEach-Object { Write-Host "  $_" }
$badging = & $Aapt2 dump badging $FinalApk 2>&1
$badging | Select-String -Pattern '^package|^application-label|^launchable-activity|^native-code|^sdkVersion|^targetSdkVersion' | ForEach-Object { Write-Host "  $($_.Line)" }

Step 'delivering'
if (Test-Path $Deliverable) { Remove-Item $Deliverable -Force }
Copy-Item $FinalApk $Deliverable -Force

$apk = Get-Item $Deliverable
Write-Host "`nOK: $($apk.FullName)  ($([math]::Round($apk.Length/1MB,1)) MB)" -ForegroundColor Green
exit 0
