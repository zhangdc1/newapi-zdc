import { createFileRoute } from '@tanstack/react-router'
import { ImageGen } from '@/features/image-gen'

export const Route = createFileRoute('/_authenticated/image-gen/')({
  component: ImageGen,
})
