#!/usr/bin/env node
// 假 ego-browser：读完 stdin 后一直不退出，用来测 runEgoScript 的超时路径。
// 先把自己的 pid 打到 stderr，测试据此确认超时后进程已被杀掉。
process.stderr.write(`hang-pid ${process.pid}\n`);
process.stdin.resume();
process.stdin.on('end', () => setInterval(() => {}, 60_000));
