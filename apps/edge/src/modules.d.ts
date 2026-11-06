declare module "*.sql" {
  const text: string;
  export default text;
}
declare module "cloudflare:node" {
  export function handleAsNodeRequest(port: number, request: Request): Promise<Response>;
}
