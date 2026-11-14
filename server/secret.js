'use strict';
/**
 * API Key 本地保护
 * Windows 下使用 DPAPI（当前用户范围）加密，密钥只能被同一台机器的同一用户解开。
 * 其他平台或调用失败时退化为 base64 明文（会在设置页提示）。
 */
const { spawnSync } = require('node:child_process');

const IS_WIN = process.platform === 'win32';

const PS_PROTECT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$b=[Console]::In.ReadToEnd()',
  'if(-not $b){exit 1}',
  '$raw=[Convert]::FromBase64String($b.Trim())',
  "$e=[System.Security.Cryptography.ProtectedData]::Protect($raw,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  '[Convert]::ToBase64String($e)',
].join(';');

const PS_UNPROTECT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$b=[Console]::In.ReadToEnd()',
  'if(-not $b){exit 1}',
  '$raw=[Convert]::FromBase64String($b.Trim())',
  "$d=[System.Security.Cryptography.ProtectedData]::Unprotect($raw,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  '[Convert]::ToBase64String($d)',
].join(';');

function runPs(script, input) {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { input, encoding: 'utf8', windowsHide: true, timeout: 20000 }
  );
  if (r.error) throw r.error;
  if (r.status !== 0 || !r.stdout) {
    throw new Error((r.stderr || '').trim() || 'DPAPI 调用失败');
  }
  return r.stdout.trim();
}

function protect(text) {
  if (!IS_WIN) {
    return { enc: 'plain', data: Buffer.from(text, 'utf8').toString('base64') };
  }
  try {
    const out = runPs(PS_PROTECT, Buffer.from(text, 'utf8').toString('base64'));
    return { enc: 'dpapi', data: out };
  } catch {
    return { enc: 'plain', data: Buffer.from(text, 'utf8').toString('base64') };
  }
}

function unprotect(rec) {
  if (!rec || !rec.data) return '';
  try {
    if (rec.enc === 'plain') return Buffer.from(rec.data, 'base64').toString('utf8');
    if (rec.enc === 'dpapi') {
      const b64 = runPs(PS_UNPROTECT, rec.data);
      return Buffer.from(b64, 'base64').toString('utf8');
    }
  } catch {
    return '';
  }
  return '';
}

function isStrong(rec) {
  return !!rec && rec.enc === 'dpapi';
}

module.exports = { protect, unprotect, isStrong };
