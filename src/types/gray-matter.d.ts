declare module 'gray-matter' {
  interface MatterResult {
    data: Record<string, unknown>;
    content: string;
    excerpt?: string;
  }

  function matter(input: string, options?: Record<string, unknown>): MatterResult;

  export = matter;
}