import { createRouter } from '@tanstack/react-router'
import { routeTree } from '@/routeTree.gen'
import { getContext } from '@/integrations/tanstack-query/root-provider'

export const router = createRouter({
  routeTree,
  context: getContext(),
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
