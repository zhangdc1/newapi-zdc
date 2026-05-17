import { useState, useEffect } from 'react'
import { Image as ImageIcon, Download, Loader2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface GeneratedImage {
  url: string
  revised_prompt?: string
}

const SIZES = [
  { value: '1024x1024', label: '1:1 方形 (1024×1024)' },
  { value: '1792x1024', label: '16:9 横向 (1792×1024)' },
  { value: '1024x1792', label: '9:16 竖向 (1024×1792)' },
  { value: '512x512', label: '小图 (512×512)' },
]

const QUALITIES = [
  { value: 'standard', label: '标准' },
  { value: 'hd', label: 'HD 高清' },
]

export function ImageGen() {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [quality, setQuality] = useState('standard')
  const [n, setN] = useState('1')
  const [loading, setLoading] = useState(false)
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [imageModels, setImageModels] = useState<Array<{ value: string; label: string }>>([])
  const [loadingModels, setLoadingModels] = useState(true)

  useEffect(() => {
    fetchImageModels()
  }, [])

  async function fetchImageModels() {
    try {
      const res = await api.get('/api/user/models')
      if (res.data?.success && res.data?.data) {
        // 过滤出图片生成相关的模型
        const imageModelNames = (res.data.data as string[]).filter((m: string) =>
          m.toLowerCase().includes('dall-e') ||
          m.toLowerCase().includes('flux') ||
          m.toLowerCase().includes('midjourney') ||
          m.toLowerCase().includes('stable-diffusion') ||
          m.toLowerCase().includes('sd-') ||
          m.toLowerCase().includes('imagen')
        )
        const models = imageModelNames.map((m: string) => ({ value: m, label: m }))
        setImageModels(models)
        if (models.length > 0) {
          setModel(models[0].value)
        }
      }
    } catch (e) {
      console.error('Failed to fetch models:', e)
      toast.error('获取模型列表失败')
    } finally {
      setLoadingModels(false)
    }
  }

  async function generate() {
    if (!prompt.trim()) {
      toast.error('请输入提示词')
      return
    }
    setLoading(true)
    setImages([])
    try {
      const res = await api.post('/v1/images/generations', {
        model,
        prompt,
        n: parseInt(n),
        size,
        quality,
        response_format: 'url',
      })
      if (res.data?.data?.length > 0) {
        setImages(res.data.data)
        toast.success(`生成成功，共 ${res.data.data.length} 张`)
      } else {
        toast.error('生成失败，未返回图片')
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || '生成失败'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  function downloadImage(url: string, idx: number) {
    const a = document.createElement('a')
    a.href = url
    a.download = `generated-${idx + 1}.png`
    a.target = '_blank'
    a.click()
  }

  return (
    <div className="flex h-full">
      {/* 左侧参数面板 */}
      <div className="w-72 shrink-0 border-r p-4 space-y-4 overflow-y-auto">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-purple-400" />
          <h2 className="font-semibold">图片生成</h2>
        </div>

        <div className="space-y-2">
          <Label>模型</Label>
          <Select value={model} onValueChange={setModel} disabled={loadingModels}>
            <SelectTrigger>
              <SelectValue placeholder={loadingModels ? '加载中...' : imageModels.length === 0 ? '无可用模型' : '选择模型'} />
            </SelectTrigger>
            <SelectContent>
              {imageModels.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>尺寸</Label>
          <Select value={size} onValueChange={setSize}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>质量</Label>
          <Select value={quality} onValueChange={setQuality}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUALITIES.map((q) => (
                <SelectItem key={q.value} value={q.value}>
                  {q.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>生成数量</Label>
          <Select value={n} onValueChange={setN}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['1', '2', '3', '4'].map((v) => (
                <SelectItem key={v} value={v}>
                  {v} 张
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>提示词</Label>
          <Textarea
            placeholder="描述你想生成的图片，越详细越好..."
            className="min-h-[120px] resize-none"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) generate()
            }}
          />
          <p className="text-xs text-muted-foreground">Ctrl+Enter 快速生成</p>
        </div>

        <Button
          className="w-full bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90"
          onClick={generate}
          disabled={loading || loadingModels || imageModels.length === 0}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4 mr-2" />
          )}
          {loading ? '生成中...' : loadingModels ? '加载中...' : imageModels.length === 0 ? '无可用模型' : '开始生成'}
        </Button>
      </div>

      {/* 右侧结果区 */}
      <div className="flex-1 p-6 overflow-y-auto">
        {images.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
            <div className="w-24 h-24 rounded-2xl bg-muted flex items-center justify-center">
              <ImageIcon className="h-10 w-10 opacity-30" />
            </div>
            <p>填写参数并点击「开始生成」</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-purple-400" />
            <p>AI 正在创作，请稍候...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {images.map((img, idx) => (
              <Card
                key={idx}
                className="overflow-hidden group border-purple-500/10 hover:border-purple-500/30 transition-colors"
              >
                <div className="relative aspect-square bg-muted">
                  <img
                    src={img.url}
                    alt={`Generated ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => downloadImage(img.url, idx)}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      下载
                    </Button>
                  </div>
                </div>
                {img.revised_prompt && (
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {img.revised_prompt}
                    </p>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
