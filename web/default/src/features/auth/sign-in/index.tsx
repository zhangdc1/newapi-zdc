import { Link, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useStatus } from '@/hooks/use-status'
import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { t } = useTranslation()
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const { status } = useStatus()

  return (
    <AuthLayout>
      <div className='w-full space-y-7'>
        <div className='space-y-3'>
          <div className='bg-primary/10 text-primary inline-flex rounded-full px-3 py-1 text-xs font-semibold'>
            {t('Welcome back')}
          </div>
          <h2 className='text-3xl leading-tight font-semibold tracking-tight'>
            {t('Sign in')}
          </h2>
          {!status?.self_use_mode_enabled && (
            <p className='text-muted-foreground text-sm leading-6'>
              {t("Don't have an account?")}{' '}
              <Link
                to='/sign-up'
                className='text-primary font-medium underline underline-offset-4 hover:opacity-80'
              >
                {t('Sign up')}
              </Link>
              .
            </p>
          )}
        </div>

        <UserAuthForm redirectTo={redirect} />

        <TermsFooter
          variant='sign-in'
          status={status}
          className='text-center'
        />
      </div>
    </AuthLayout>
  )
}
