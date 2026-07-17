declare module "markdown-it-footnote" {
  const plugin: (md: any) => void;
  export default plugin;
}

declare module "markdown-it-task-lists" {
  const plugin: (md: any, options?: Record<string, unknown>) => void;
  export default plugin;
}

declare module "markdown-it-deflist" {
  const plugin: (md: any) => void;
  export default plugin;
}
