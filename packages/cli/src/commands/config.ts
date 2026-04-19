// ============================================================
// Config Command - Configuration management
// ============================================================

import chalk from 'chalk'
import { loadConfig, saveConfig, setConfigValue, getConfigPath } from '../lib/config-store'

export interface ConfigOptions {}

/**
 * Show current configuration
 */
export async function configShow(): Promise<void> {
  const config = loadConfig()
  const configPath = getConfigPath()

  console.log(chalk.blue('Configuration'))
  console.log(chalk.gray(`  Path: ${configPath}`))
  console.log()

  if (Object.keys(config).length === 0) {
    console.log(chalk.yellow('  No configuration set.'))
    console.log(chalk.gray('  Use "thething config set <key> <value>" to set values.'))
    return
  }

  console.log(JSON.stringify(config, null, 2))
}

/**
 * Set configuration value
 */
export async function configSet(key: string, value: string): Promise<void> {
  setConfigValue(key, value)
  console.log(chalk.green(`Set ${key} = ${value}`))
  console.log(chalk.gray(`  Config file: ${getConfigPath()}`))
}

// Export as module
export default {
  show: configShow,
  set: configSet,
}