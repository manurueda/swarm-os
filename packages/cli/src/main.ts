#!/usr/bin/env node
/**
 * Swarm OS CLI.
 *
 * swarm doctor                     is this machine ready, and on what billing basis
 * swarm map [path]                 understand a repository as modules
 * swarm status                     what exists, what is awake, what it costs
 * swarm ui                         open a local visual view of the repository
 * swarm mission "<goal>"           put the swarms to work
 * swarm missions                   past missions
 * swarm memory [module]            what a swarm knows
 * swarm verify [module]            check that memory against the code
 * swarm refactor [module]          propose structural fixes to the code itself
 * swarm sleep [module]             compress memory, release the swarm
 * swarm wake <module>              mark a swarm active
 * swarm update                     update Swarm OS itself
 */

import { parseArgs } from './args.js';
import { UserError } from './context.js';
import { doctorCommand } from './commands/doctor.js';
import { mapCommand } from './commands/map.js';
import { missionCommand, missionsCommand } from './commands/mission.js';
import { memoryCommand, statusCommand } from './commands/status.js';
import { sleepCommand, wakeCommand } from './commands/swarms.js';
import { verifyCommand } from './commands/verify.js';
import { refactorCommand } from './commands/refactor.js';
import { uiCommand } from './commands/ui.js';
import { noticeIfUpdated, scheduleBackgroundUpdate, updateCommand } from './commands/update.js';
import { c, fail, line, note } from './ui.js';

const VERSION = '0.1.0';

const HELP = `${c.bold('swarm')} — run coding agents as sleeping, per-module swarms

${c.gray('Large repositories break agents by exhausting their context. Swarm OS')}
${c.gray('partitions a repo into modules, gives each durable compressed memory,')}
${c.gray('and wakes only the modules a task actually touches.')}

${c.bold('Commands')}
  doctor                    check the runtime and confirm subscription billing
  map [path]                understand a repository as modules (incremental)
  status                    swarms, their state, and what they cost
  ui                        open a local visual view of the repository
  mission "<goal>"          route a goal to modules and run them in parallel
  missions                  list past missions
  memory [module]           read what a swarm knows
  verify [module]           check the memory is true, not just confident
  refactor [module]         find where the code's structure is what makes it hard
  sleep [module]            compress memory and release
  wake <module>             mark a swarm active
  update                    update Swarm OS itself

${c.bold('Common flags')}
  --repo <path>             operate on a specific repository
  --model <name>            model for work agents          (default: sonnet)
  --system-model <name>     model for routing/analysis/compression
  --concurrency <n>         max agents at once             (default: 3)
  --dry-run                 mission: route and plan, spawn nothing
  --modules <a,b>           mission: skip routing, target these modules
  --force                   map: re-analyse everything, discard existing map
  --repartition             map: redraw module boundaries, keep memory
  --measure                 doctor: measure lean-spawn savings on this machine
  --citations-only          verify: deterministic check only, no agents
  --signals-only            refactor: deterministic signals only, no agents
  --no-open                 ui: write the file without opening a browser
  --check                   update: report only, do not apply

${c.bold('Getting started')}
  ${c.gray('$')} swarm doctor
  ${c.gray('$')} cd ~/your-big-repo && swarm map
  ${c.gray('$')} swarm mission "make the timeline smooth with 100+ scenes" --dry-run

${c.gray('Swarm OS never handles your credentials. Authenticate once with')}
${c.gray('`claude auth login`; agents inherit that. No API keys, ever.')}

${c.gray('Updates itself in the background once a day, after a command finishes,')}
${c.gray('never during one. Disable with SWARM_NO_UPDATE=1.')}
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.flags['version'] === true || args.flags['v'] === true || args.command === 'version') {
    line(VERSION);
    return 0;
  }
  if (!args.command || args.command === 'help' || args.flags['help'] === true || args.flags['h'] === true) {
    line(HELP);
    return 0;
  }

  // A background worker may have installed a new version since last run.
  if (args.command !== 'update') await noticeIfUpdated();

  switch (args.command) {
    case 'doctor':
      return doctorCommand(args);
    case 'map':
      return mapCommand(args);
    case 'status':
      return statusCommand(args);
    case 'mission':
      return missionCommand(args);
    case 'missions':
      return missionsCommand(args);
    case 'memory':
      return memoryCommand(args);
    case 'verify':
      return verifyCommand(args);
    case 'refactor':
      return refactorCommand(args);
    case 'ui':
      return uiCommand(args);
    case 'update':
      return updateCommand(args);
    case 'sleep':
      return sleepCommand(args);
    case 'wake':
      return wakeCommand(args);
    default:
      fail(`unknown command \`${args.command}\``);
      note('Run `swarm help` for usage.');
      return 1;
  }
}

let interrupted = false;
process.on('SIGINT', () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  line();
  note('interrupting — agents are being stopped, swarms will be left as they are');
  process.exit(130);
});

main()
  .then(async (code) => {
    process.exitCode = code;
    // Only ever after the real work is done, so an update can never compete
    // with a running mission or swap files under a live agent.
    if (!process.env['SWARM_UPDATE_WORKER']) await scheduleBackgroundUpdate();
  })
  .catch((err: unknown) => {
    line();
    if (err instanceof UserError) {
      fail(err.message);
    } else if (err instanceof Error) {
      fail(err.message);
      if (process.env['SWARM_DEBUG']) note(err.stack ?? '');
    } else {
      fail(String(err));
    }
    process.exitCode = 1;
  });
