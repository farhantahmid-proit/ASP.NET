import { useMutation } from '@tanstack/react-query'
import { runLiveLighthouse, runPageSpeedAudit } from './live-audit'

export function useRunPageSpeedAudit() {
  return useMutation({ mutationFn: runPageSpeedAudit })
}

export function useRunLiveLighthouse() {
  return useMutation({ mutationFn: runLiveLighthouse })
}
