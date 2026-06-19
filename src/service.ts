import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const LABEL = 'com.claude-code-tg.bot';

/**
 * Установка/снятие автозапуска через macOS launchd (LaunchAgent).
 * Запускать от установленного CLI: `claude-code-tg install-service`.
 */
export function serviceCommand(action: 'install' | 'uninstall'): void {
  if (process.platform !== 'darwin') {
    console.log('Автозапуск через launchd поддерживается только на macOS.');
    console.log('На Linux используй systemd --user; в любом случае подойдут tmux/screen или nohup.');
    return;
  }

  const uid = process.getuid?.() ?? 0;
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

  if (action === 'uninstall') {
    spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
    try {
      rmSync(plistPath);
    } catch {
      /* уже нет */
    }
    console.log(`Автозапуск отключён. Удалён: ${plistPath}`);
    return;
  }

  const node = process.execPath;
  const entry = join(dirname(fileURLToPath(import.meta.url)), 'index.js');
  const logPath = join(homedir(), '.config', 'claude-code-tg', 'bot.log');
  mkdirSync(dirname(logPath), { recursive: true });
  const path = [
    dirname(node),
    join(homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(':');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${node}</string>
        <string>${entry}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${homedir()}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${path}</string>
        <key>HOME</key>
        <string>${homedir()}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
</dict>
</plist>
`;

  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, plist);
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`]); // на случай уже загруженного
  const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { encoding: 'utf8' });

  console.log(`Plist:  ${plistPath}`);
  console.log(`Лог:    ${logPath}`);
  if (r.status === 0) {
    console.log('Автозапуск включён: бот запущен и будет подниматься при входе в систему.');
  } else {
    console.log(`launchctl bootstrap вернул код ${r.status}: ${(r.stderr || '').trim()}`);
  }
  console.log('');
  console.log('Важно:');
  console.log('  - Перед включением остановите бот, запущенный вручную (один токен = один инстанс, иначе ошибка 409).');
  console.log('  - Если рабочая папка под ~/Desktop, ~/Documents или ~/Downloads — выдайте Full Disk Access');
  console.log('    для node в Системных настройках -> Конфиденциальность и безопасность, иначе launchd');
  console.log('    не получит доступ к файлам (или перенесите проект в незащищённый путь, например ~/projects).');
  console.log('  - Снять автозапуск: claude-code-tg uninstall-service');
}
