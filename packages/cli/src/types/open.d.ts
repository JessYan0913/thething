declare module 'open' {
  function open(target: string, options?: { app?: string | string[] }): Promise<void>
  export default open
}