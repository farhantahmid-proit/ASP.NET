export interface SrTooltipProps {
  tooltipId: string
  text: string
}

export function SrTooltip({ tooltipId, text }: SrTooltipProps) {
  return (
    <span id={tooltipId} role="tooltip" className="sr-only">
      {text}
    </span>
  )
}
