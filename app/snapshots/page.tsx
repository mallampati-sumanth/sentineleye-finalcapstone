'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowDownToLine, ArrowLeft, Camera, Filter, Image, Trash2 } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { mutate } from 'swr'
import { fmtTime } from '@/lib/sentinel'
import { useSentinelEvents, type SentinelEvent } from '@/lib/hooks/use-sentinel-events'
import { createClient } from '@/lib/supabase/client'

type Snapshot = SentinelEvent

export default function SnapshotsPage() {
  const { data: items = [], error, isLoading } = useSentinelEvents()
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<Snapshot | null>(null)
  const visible = items.filter(item => filter === 'all' || item.type.toLowerCase() === filter)
  const remove = async (item: Snapshot) => {
    const supabase = createClient()
    const { data: row, error: readError } = await supabase.from('sentinel_events').select('storage_path').eq('id', item.id).single()
    if (readError) { toast.error('Could not remove this event.'); return }
    const { error: deleteError } = await supabase.from('sentinel_events').delete().eq('id', item.id)
    if (deleteError) { toast.error('Could not remove this event.'); return }
    if (row?.storage_path) await supabase.storage.from('sentinel-snapshots').remove([row.storage_path])
    setSelected(null)
    await mutate('sentinel-events')
    toast.success('Event removed from your archive')
  }
  const download = (item: Snapshot) => {
    if (!item.imageUrl) { toast.error('Snapshot image unavailable'); return }
    const anchor = document.createElement('a')
    anchor.href = item.imageUrl
    anchor.download = `sentinel-${item.id}.jpg`
    anchor.click()
  }
  return <main className="settings-shell"><Toaster theme="dark" position="top-right"/><header className="settings-header"><Link href="/viewer" className="back-link"><ArrowLeft size={16}/> Back to monitor</Link><div className="brand"><span className="brand-mark"><Camera size={17}/></span> Sentinel<span>Eye</span></div></header><section className="settings-content gallery-content"><p className="eyebrow">EVENT ARCHIVE</p><h1>Snapshot gallery</h1><p className="page-subtitle">Private camera snapshots and person-detection events from your account.</p><div className="gallery-toolbar"><div className="filter-control"><Filter size={15}/><select aria-label="Filter snapshots" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All events</option><option value="ai">Person detected</option><option value="pir">PIR motion</option></select></div><span className="muted">{visible.length} events</span></div>{error&&<div className="network-warning">Your event archive could not be loaded.<button onClick={() => void mutate('sentinel-events')}>Retry</button></div>}
    {isLoading?<div className="snapshot-grid">{[1,2,3,4,5,6].map(number=><div className="snapshot-skeleton" key={number}/>)}</div>:visible.length?<div className="snapshot-grid">{visible.map(item=><article className="snapshot-card" key={item.id}><button className="snapshot-image" onClick={()=>setSelected(item)}>{item.imageUrl?<img src={item.imageUrl} alt={`Person detection snapshot from ${fmtTime(item.timestamp)}`} loading="lazy"/>:<div className="snapshot-placeholder"><Image size={24}/><span>Image unavailable</span></div>}<span className="snapshot-type">{item.type==='AI'?'PERSON DETECTED':'PIR MOTION'}</span></button><div className="snapshot-meta"><div><strong>{item.type==='AI'?'Person detected':'PIR motion'}</strong><span>{fmtTime(item.timestamp)}{item.confidence!=null?` · ${Math.round(item.confidence*100)}% confidence`:''}</span></div><button className="icon-button" aria-label="Download snapshot" onClick={()=>download(item)}><ArrowDownToLine size={15}/></button><button className="icon-button" aria-label="Delete snapshot" onClick={()=>void remove(item)}><Trash2 size={15}/></button></div></article>)}</div>:<div className="gallery-empty"><span className="empty-icon"><Camera size={25}/></span><h2>No events recorded yet</h2><p>Keep the camera node open on a signed-in phone. Person detections inside your restricted zone will appear here.</p><Link href="/" className="button button-primary">Open camera node</Link></div>}</section>{selected&&<div className="modal-backdrop" onClick={()=>setSelected(null)}><div className="snapshot-modal" onClick={event=>event.stopPropagation()}><button className="modal-close" aria-label="Close" onClick={()=>setSelected(null)}>×</button>{selected.imageUrl?<img src={selected.imageUrl} alt="Selected private detection snapshot"/>:<div className="modal-empty"><Camera size={30}/><span>Snapshot unavailable</span></div>}<strong>{selected.type==='AI'?'Person detected':'PIR motion'} · {fmtTime(selected.timestamp)}{selected.confidence!=null?` · ${Math.round(selected.confidence*100)}% confidence`:''}</strong></div></div>}</main>
}
