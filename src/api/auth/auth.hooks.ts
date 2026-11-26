import { useMutation } from '@tanstack/react-query'
import { loginWorkspace, registerWorkspace } from './auth'

export function useRegisterWorkspace() {
  return useMutation({ mutationFn: registerWorkspace })
}

export function useLoginWorkspace() {
  return useMutation({ mutationFn: loginWorkspace })
}
