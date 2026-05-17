import { useState, useEffect } from 'react'
import { Video as VideoIcon, Loader2, Wand2, Play } from 'lucide-react'
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

interface VideoTask {
  task_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  video_url?: string
  prompt: string
  created_at: number
}

const DURATIONS = [
  { value: '5', label: '5 秒' },
  { value: '10', label: '10 秒' },
  { value: '15', label: '15 秒' },
  { value: '30', label: '30 秒' },
]

const RATIOS = [
  { value: '16:9', label: '16:9 横向' },
  { value: '9:16', label: '9:16 竖向' },
  { value: '1:1', label: '1:1 方形' },
]

export function VideoGen() {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [duration, setDuration] = useState('5')
  const [ratio, setRatio] = useState('16:9')
  const [loading, setLoading] = useState(false)
  const [tasks, setTasks] = useState<VideoTask[]>([])
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [videoModels, setVideoModels] = useState<Array<{ value: string; label: string }>>([])
  const [loadingModels, setLoadingModels] = useState(true)

  useEffect(() => {
    fetchVideoModels()
  }, [])

  async function fetchVideoModels() {
    try {
      const res = await api.get('/api/user/models')
      if (res.data?.success && res.data?.data) {
        // 过滤出视频生成相关的模型
        const videoModelNames = (res.data.data as string[]).filter((m: string) =>
          m.toLowerCase().includes('kling') ||
          m.toLowerCase().includes('sora') ||
          m.toLowerCase().includes('runway') ||
          m.toLowerCase().includes('gen-') ||
          m.toLowerCase().includes('video') ||
          m.toLowerCase().includes('pika')
        )
        const models = videoModelNames.map((m: string) => ({ value: m, label: m }))
        setVideoModels(models)
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
    try {
      // 视频生成通过任务队列，先提交任务
      const res = await api.post('/v1/video/generations', {
        model,
        prompt,
        duration: parseInt(duration),
        aspect_ratio: ratio,
      })
      if (res.data?.task_id || res.data?.id) {
        const taskId = res.data.task_id || res.data.id
        const newTask: VideoTask = {
          task_id: taskId,
          status: 'pending',
          prompt,
          created_at: Date.now(),
        }
        setTasks((prev) => [newTask, ...prev])
        toast.success('任务已提交，正在生成中...')
        // 轮询状态
        pollTaskStatus(taskId)
      } else {
        toast.error('任务提交失败')
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || '提交失败'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  async function pollTaskStatus(taskId: string) {
    const maxAttempts = 60
    let attempt = 0
    const poll = async () => {
      if (attempt++ >= maxAttempts) return
      try {
        const res = await api.get(`/api/task/self?task_id=${taskId}`)
        const task = res.data?.data?.[0]
        if (!task) return
        const status = task.status?.toLowerCase()
        if (status === 'success' || status === 'completed') {
          setTasks((prev) =>
            prev.map((t) =>
              t.task_id === taskId
                ? { ...t, status: 'completed', video_url: task.result_url || task.video_url }
                : t,
            ),
          )
          toast.success('视频生成完成！')
        } else if (status === 'failed' || status === 'failure') {
          setTasks((prev) =>
            prev.map((t) => (t.task_id === taskId ? { ...t, status: 'failed' } : t)),
          )
          toast.error('视频生成失败')
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.task_id === taskId ? { ...t, status: 'processing' } : t)),
          )
          setTimeout(poll, 5000)
        }
      } catch {
        setTimeout(poll, 8000)
      }
    }
    setTimeout(poll, 5000)
  }

  return (
    <div className="flex h-full">
      {/* 左侧参数面板 */}
      <div className="w-72 shrink-0 border-r p-4 space-y-4 overflow-y-auto">
        <div className="flex items-center gap-2">
          <VideoIcon className="h-5 w-5 text-cyan-400" />
          <h2 className="font-semibold">视频生成</h2>
        </div>

        <div className="space-y-2">
          <Label>模型</Label>
          <Select value={model} onValueChange={setModel} disabled={loadingModels}>
            <SelectTrigger>
              <SelectValue placeholder={loadingModels ? '加载中...' : videoModels.length === 0 ? '无可用模型' : '选择模型'} />
            </SelectTrigger>
            <SelectContent>
              {videoModels.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>时长</Label>
          <Select value={duration} onValueChange={setDuration}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>比例</Label>
          <Select value={ratio} onValueChange={setRatio}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RATIOS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>提示词</Label>
          <Textarea
            placeholder="描述你想生成的视频内容，包括场景、动作、风格..."
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
          className="w-full bg-gradient-to-r from-cyan-500 to-purple-600 hover:opacity-90"
          onClick={generate}
          disabled={loading || loadingModels || videoModels.length === 0}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4 mr-2" />
          )}
          {loading ? '提交中...' : loadingModels ? '加载中...' : videoModels.length === 0 ? '无可用模型' : '开始生成'}
        </Button>
      </div>

      {/* 右侧任务列表 */}
      <div className="flex-1 p-6 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
            <div className="w-24 h-24 rounded-2xl bg-muted flex items-center justify-center">
              <VideoIcon className="h-10 w-10 opacity-30" />
            </div>
            <p>填写参数并点击「开始生成」</p>
            <p className="text-xs">视频生成需要数分钟，提交后会自动轮询进度</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => (
              <Card
                key={task.task_id}
                className="border-cyan-500/10 hover:border-cyan-500/20 transition-colors"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{task.prompt}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(task.created_at).toLocaleTimeString('zh-CN')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {task.status === 'pending' || task.status === 'processing' ? (
                        <div className="flex items-center gap-1.5 text-yellow-400 text-sm">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {task.status === 'pending' ? '排队中' : '生成中'}
                        </div>
                      ) : task.status === 'failed' ? (
                        <span className="text-sm text-destructive">生成失败</span>
                      ) : null}
                    </div>
                  </div>

                  {task.status === 'completed' && task.video_url && (
                    <div className="mt-3">
                      {playingId === task.task_id ? (
                        <video
                          controls
                          autoPlay
                          className="w-full rounded-lg max-h-[400px]"
                          src={task.video_url}
                        />
                      ) : (
                        <div
                          className="relative bg-black rounded-lg aspect-video flex items-center justify-center cursor-pointer group"
                          onClick={() => setPlayingId(task.task_id)}
                        >
                          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors">
                            <Play className="h-6 w-6 text-white ml-1" />
                          </div>
                          <span className="absolute bottom-2 right-2 text-xs text-white/60">
                            点击播放
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
