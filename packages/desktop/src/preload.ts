import { contextBridge, ipcRenderer } from 'electron';

// Expose APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Open the native directory picker dialog.
   * @returns The selected directory path, or null if canceled.
   */
  selectDirectory: async (): Promise<string | null> => {
    const result = await ipcRenderer.invoke('dialog:showOpenDialog', {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project Directory',
      buttonLabel: 'Select Directory',
    });

    if (result.canceled || !result.filePaths?.length) {
      return null;
    }

    return result.filePaths[0];
  },
});
