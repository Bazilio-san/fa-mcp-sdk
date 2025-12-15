/**
 * Пример расширения конфигурации fa-mcp-sdk кастомным блоком настроек.
 *
 * Этот файл демонстрирует, как добавить собственные настройки
 * (например, для проверки членства пользователя в AD-группе).
 */

import { AppConfig } from '../../core/index.js';

/**
 * Настройки проверки членства в AD-группе
 */
export interface IGroupAccessConfig {
  groupAccess: {
    /** AD-группа, членство в которой требуется для доступа */
    requiredGroup: string;

    /** Опционально: разрешить доступ без проверки группы (для отладки) */
    bypassGroupCheck?: boolean;

    /** Опционально: кэшировать результат проверки (секунды) */
    cacheTtlSeconds?: number;

    /** Опционально: список групп с разными уровнями доступа */
    accessLevels?: {
      /** Группа для полного доступа (read/write) */
      fullAccess?: string;
      /** Группа только для чтения */
      readOnly?: string;
      /** Группа администраторов */
      admin?: string;
    };
  };
}

/**
 * Расширенный конфиг приложения с настройками проверки групп
 */
export interface CustomAppConfig extends AppConfig, IGroupAccessConfig {}

// ========================================================================
// ПРИМЕР YAML-КОНФИГУРАЦИИ (config/default.yaml)
// ========================================================================
/*
groupAccess:
  requiredGroup: "DOMAIN\\MCP-Users"
  bypassGroupCheck: false
  cacheTtlSeconds: 300
  accessLevels:
    fullAccess: "DOMAIN\\MCP-FullAccess"
    readOnly: "DOMAIN\\MCP-ReadOnly"
    admin: "DOMAIN\\MCP-Admins"
*/

// ========================================================================
// ПРИМЕР ИСПОЛЬЗОВАНИЯ В КОДЕ
// ========================================================================
/*
import { appConfig } from '../core/index.js';

// Типизированный доступ к кастомным настройкам
const config = appConfig as CustomAppConfig;

const requiredGroup = config.groupAccess.requiredGroup;
const shouldBypass = config.groupAccess.bypassGroupCheck;

// Проверка уровня доступа из payload
function getUserAccessLevel(payload: { user: string; groups?: string[] }): 'admin' | 'full' | 'readonly' | 'none' {
  const { accessLevels } = config.groupAccess;
  const userGroups = payload.groups || [];

  if (accessLevels?.admin && userGroups.includes(accessLevels.admin)) {
    return 'admin';
  }
  if (accessLevels?.fullAccess && userGroups.includes(accessLevels.fullAccess)) {
    return 'full';
  }
  if (accessLevels?.readOnly && userGroups.includes(accessLevels.readOnly)) {
    return 'readonly';
  }
  return 'none';
}
*/
