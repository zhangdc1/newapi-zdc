import { createFileRoute } from '@tanstack/react-router'
import { VideoGen } from '@/features/video-gen'

export const Route = createFileRoute('/_authenticated/video-gen/')({
  component: VideoGen,
})
