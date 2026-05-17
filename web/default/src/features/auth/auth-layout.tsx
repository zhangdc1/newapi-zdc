import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useSystemConfig } from '@/hooks/use-system-config'
import { Skeleton } from '@/components/ui/skeleton'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()

  return (
    <div className='bg-background relative grid min-h-svh max-w-none overflow-hidden'>
      <div className='from-primary/8 via-background to-muted/70 absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,var(--tw-gradient-from),transparent_30%),linear-gradient(135deg,var(--tw-gradient-via),var(--tw-gradient-to))]' />
      <div className='absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:44px_44px] opacity-[0.22] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]' />
      <Link
        to='/'
        className='bg-background/70 border-border/70 absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full border px-3 py-2 shadow-sm backdrop-blur-xl transition-opacity hover:opacity-80 sm:top-8 sm:left-8'
      >
        <div className='relative h-8 w-8'>
          {loading ? (
            <Skeleton className='absolute inset-0 rounded-full' />
          ) : (
            <img
              src={logo}
              alt={t('Logo')}
              className='h-8 w-8 rounded-full object-cover ring-1 ring-black/5'
            />
          )}
        </div>
        {loading ? (
          <Skeleton className='h-6 w-24' />
        ) : (
          <h1 className='text-base font-semibold'>{systemName}</h1>
        )}
      </Link>

      <div className='relative z-1 grid min-h-svh w-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_520px]'>
        <section className='hidden items-center px-10 lg:flex xl:px-16'>
          <div className='max-w-xl space-y-8'>
            <div className='space-y-4'>
              <p className='text-primary text-sm font-semibold tracking-[0.18em] uppercase'>
                {t('Unified AI gateway')}
              </p>
              <h2 className='text-foreground max-w-lg text-4xl leading-tight font-semibold tracking-tight xl:text-5xl'>
                {t('Secure access to your AI workspace')}
              </h2>
              <p className='text-muted-foreground max-w-md text-base leading-7'>
                {t(
                  'Manage models, keys, billing, and usage from one calm control center.'
                )}
              </p>
            </div>

            <div className='grid max-w-lg grid-cols-3 gap-3'>
              {[
                t('Stable routing'),
                t('Usage insights'),
                t('Secure billing'),
              ].map((item) => (
                <div
                  key={item}
                  className='border-border/70 bg-background/60 rounded-lg border px-4 py-3 text-sm font-medium shadow-sm backdrop-blur'
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className='flex min-h-svh items-center px-4 py-24 sm:px-6 lg:bg-background/35 lg:px-10 lg:backdrop-blur-xl'>
          <div className='border-border/70 bg-card/90 mx-auto flex w-full max-w-[440px] flex-col justify-center rounded-2xl border p-6 shadow-[0_24px_80px_-35px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:p-8'>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
