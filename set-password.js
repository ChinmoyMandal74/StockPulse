// Local account admin, run against the same Turso database the deployed app uses.
//
//   node --use-system-ca set-password.js                    # list accounts
//   node --use-system-ca set-password.js you@example.com    # set that account's password
//   node --use-system-ca set-password.js you@example.com --role owner
//
// This is the recovery path for a self-hosted app with no email sender: there is
// no "forgot password" link, so the owner resets a password from a terminal.
// The password is typed in, never passed as an argument — arguments end up in
// shell history and in the process list.
//
// Changing a password drops that user's sessions, so other devices are signed out.

require('dotenv').config();
const readline = require('readline');
const store = require('./db');

const args = process.argv.slice(2).filter((a) => a !== '--');
const email = args.find((a) => !a.startsWith('--'));
const roleIdx = args.indexOf('--role');
const role = roleIdx >= 0 ? args[roleIdx + 1] : null;

// Reads a line without echoing it, so the password never appears on screen.
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) return;
      readline.moveCursor(process.stdout, -1000, 0);
      readline.clearLine(process.stdout, 1);
      process.stdout.write(prompt + '*'.repeat(rl.line.length));
    };
    process.stdin.on('data', onData);
    rl.question(prompt, (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  const users = await store.listUsers();

  if (!email) {
    console.log('Accounts:\n');
    for (const u of users) {
      console.log('  ' + u.email.padEnd(32) + u.role.padEnd(8) + 'created ' + String(u.createdAt).slice(0, 10));
    }
    console.log('\nUsage: node --use-system-ca set-password.js <email> [--role owner|member]');
    return;
  }

  const user = users.find((u) => u.email === String(email).trim().toLowerCase());
  if (!user) {
    console.error('No account with that email. Run without arguments to list them.');
    process.exit(1);
  }

  if (role) {
    if (!['owner', 'member'].includes(role)) {
      console.error("--role must be 'owner' or 'member'.");
      process.exit(1);
    }
    // Refuse to demote the last owner — that would leave nobody able to refresh.
    if (user.role === 'owner' && role === 'member' && users.filter((u) => u.role === 'owner').length === 1) {
      console.error('That is the only owner; promote someone else first.');
      process.exit(1);
    }
    await store.setRole(user.id, role);
    console.log(`${user.email} is now ${role}.`);
  }

  const pw = await askHidden(`New password for ${user.email}: `);
  if (!pw) {
    console.log('No password entered — nothing changed.');
    return;
  }
  if (pw.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  const again = await askHidden('Confirm: ');
  if (pw !== again) {
    console.error('Passwords did not match — nothing changed.');
    process.exit(1);
  }

  await store.setPassword(user.id, pw);
  console.log(`Password updated for ${user.email}. Any existing sessions were signed out.`);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
