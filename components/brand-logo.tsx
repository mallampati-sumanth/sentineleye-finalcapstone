import Image from 'next/image'

export function BrandLogo({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`brand-lockup${inverse ? ' brand-lockup-inverse' : ''}`}>
      <Image
        src="/sentineleye-icon-1024.png"
        alt=""
        aria-hidden="true"
        width={1024}
        height={1024}
        className="brand-lockup-icon"
        priority
      />
      <Image
        src="/sentineleye-wordmark.png"
        alt="SentinelEye"
        width={1487}
        height={275}
        className="brand-lockup-wordmark"
        priority
      />
    </span>
  )
}
