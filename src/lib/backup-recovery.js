/**
 * Emergency backup and recovery utilities to prevent and recover from data loss
 */

/**
 * Get all available backups for a user
 */
export const getAvailableBackups = (userId) => {
  try {
    const backupKey = 'yanplanner_backup_' + userId;
    const backupStr = localStorage.getItem(backupKey);
    if (!backupStr) return null;
    
    const backup = JSON.parse(backupStr);
    return {
      tasks: backup.tasks || [],
      trash: backup.trash || [],
      timestamp: backup.timestamp,
      taskCount: (backup.tasks || []).length,
      trashCount: (backup.trash || []).length
    };
  } catch (e) {
    console.error('Failed to read backup', e);
    return null;
  }
};

/**
 * Restore from backup
 */
export const restoreFromBackup = (userId) => {
  try {
    const backupKey = 'yanplanner_backup_' + userId;
    const backupStr = localStorage.getItem(backupKey);
    if (!backupStr) {
      throw new Error('No backup found for this user');
    }
    
    const backup = JSON.parse(backupStr);
    return {
      tasks: backup.tasks || [],
      trash: backup.trash || [],
      timestamp: backup.timestamp
    };
  } catch (e) {
    console.error('Failed to restore backup', e);
    throw e;
  }
};

/**
 * Clear backup after successful restoration
 */
export const clearBackup = (userId) => {
  try {
    const backupKey = 'yanplanner_backup_' + userId;
    localStorage.removeItem(backupKey);
  } catch (e) {
    console.error('Failed to clear backup', e);
  }
};
