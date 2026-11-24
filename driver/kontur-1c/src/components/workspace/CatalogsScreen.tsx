'use client'

// Справочники (НСИ) — форма выбора справочника 1С: вкладки, командная панель, список

import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { C1Button, C1Input, C1Select, FormTitleBar } from '@/components/1c/kit'
import { apiPost } from './api'
import { usePoll } from './usePoll'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type Rows = { rows: Record<string, unknown>[] }

const asStr = (v: unknown) => (v === null || v === undefined ? '—' : String(v))

const KIND_RU: Record<string, string> = { tractor: 'тягач', tipper: 'самосвал', van: 'фургон' }
const BODY_RU: Record<string, string> = { tarp: 'штора', fridge: 'реф', flatbed: 'борт', tank: 'цистерна' }
const TRAILER_RU: Record<string, string> = { tarp: 'штора', fridge: 'реф', flatbed: 'борт' }

const TABS: { id: string; label: string }[] = [
  { id: 'vehicles', label: 'Транспортные средства' },
  { id: 'trailers', label: 'Прицепы' },
  { id: 'drivers', label: 'Водители' },
  { id: 'contractors', label: 'Контрагенты' },
  { id: 'locations', label: 'Пункты погрузки/выгрузки' },
]

export function CatalogsScreen({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState('vehicles')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Справочники (НСИ)" onClose={onClose} />

      {/* Вкладки справочников */}
      <div className="flex h-[32px] shrink-0 items-end gap-[2px] border-b border-[#c9c9c9] bg-[#e9e9e9] px-1.5 pt-[3px]">
        {TABS.map((t) => (
          <div
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex h-[27px] cursor-default items-center rounded-t-[4px] border border-b-0 px-3 text-[12px]',
              tab === t.id
                ? 'border-[#c9c9c9] bg-white font-semibold text-[#1c1c1c]'
                : 'border-transparent bg-[#dcdcdc] text-[#4d4d4d] hover:bg-[#e6e6e6]',
            )}
          >
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'vehicles' && <VehiclesTab active={tab === 'vehicles'} />}
      {tab === 'trailers' && <TrailersTab active={tab === 'trailers'} />}
      {tab === 'drivers' && <DriversTab active={tab === 'drivers'} />}
      {tab === 'contractors' && <ContractorsTab active={tab === 'contractors'} />}
      {tab === 'locations' && <LocationsTab active={tab === 'locations'} />}
    </div>
  )
}

function AddButton({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <C1Button className="!h-[24px]">
          <svg width="11" height="11" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#2f7a36" strokeWidth="1.6" /></svg>
          {title}
        </C1Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const entity = (fd.get('__entity') as string)
            const data: Record<string, unknown> = {}
            fd.forEach((v, k) => { if (k !== '__entity' && v !== '') data[k] = v })
            try {
              await apiPost(`/api/office/catalog/${entity}`, data)
              toast.success('Запись создана')
              ;(document.activeElement as HTMLElement)?.blur()
              setTimeout(() => window.dispatchEvent(new CustomEvent('catalog-updated')), 300)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Ошибка')
            }
          }}
          className="grid gap-3"
        >
          {children}
          <DialogFooter>
            <C1Button type="submit" accent>Создать</C1Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <label className="c1-label">{label}</label>
      {children}
    </div>
  )
}

function VehiclesTab({ active }: { active: boolean }) {
  const { data } = usePoll<Rows>('/api/office/catalog/vehicles', active ? 5000 : 3600000)
  return (
    <>
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <AddButton title="Новое ТС">
          <input type="hidden" name="__entity" value="vehicles" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Модель"><C1Input name="model" required placeholder="МАЗ 5440" /></Field>
            <Field label="Госномер"><C1Input name="plate" required placeholder="А 000 АА 23" /></Field>
            <Field label="Тип">
              <C1Select name="kind" value="tractor" options={[
                { value: 'tractor', label: 'тягач' }, { value: 'tipper', label: 'самосвал' }, { value: 'van', label: 'фургон' },
              ]} />
            </Field>
            <Field label="Кузов">
              <C1Select name="bodyType" value="tarp" options={[
                { value: 'tarp', label: 'штора' }, { value: 'fridge', label: 'реф' }, { value: 'flatbed', label: 'борт' }, { value: 'tank', label: 'цистерна' },
              ]} />
            </Field>
            <Field label="Грузоподъёмность, т"><C1Input name="capacityT" type="number" step="0.1" required defaultValue="20" /></Field>
            <Field label="Объём, м³"><C1Input name="volumeM3" type="number" step="1" /></Field>
            <Field label="Готовность">
              <C1Select name="readiness" value="ready" options={[
                { value: 'ready', label: 'готов' }, { value: 'maintenance', label: 'обслуживание' }, { value: 'repair', label: 'ремонт' },
              ]} />
            </Field>
          </div>
        </AddButton>
        <span className="ml-3 text-[12px] text-[#8a8a8a]">Правила 5.3 читают этот справочник при отборе ТС</span>
      </div>
      <div className="c1-scroll min-h-0 flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr><th className="w-[180px]">Модель</th><th className="w-[110px]">Госномер</th><th className="w-[100px]">Тип</th><th className="w-[100px]">Кузов</th><th className="w-[90px]">Груз, т</th><th className="w-[120px]">Готовность</th></tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((v) => (
              <tr key={String(v.id)}>
                <td>{asStr(v.model)}</td>
                <td>{asStr(v.plate)}</td>
                <td>{KIND_RU[String(v.kind)] ?? asStr(v.kind)}</td>
                <td>{BODY_RU[String(v.bodyType)] ?? asStr(v.bodyType)}</td>
                <td>{asStr(v.capacityT)}</td>
                <td>{v.readiness === 'ready' ? 'готов' : v.readiness === 'repair' ? 'ремонт' : 'обслуживание'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function TrailersTab({ active }: { active: boolean }) {
  const { data } = usePoll<Rows>('/api/office/catalog/trailers', active ? 5000 : 3600000)
  return (
    <>
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <AddButton title="Новый прицеп">
          <input type="hidden" name="__entity" value="trailers" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Модель"><C1Input name="model" required placeholder="Schmitz SCS 24" /></Field>
            <Field label="Госномер"><C1Input name="plate" required placeholder="АВ 000 23" /></Field>
            <div className="col-span-2">
              <Field label="Тип">
                <C1Select name="type" value="tarp" options={[
                  { value: 'tarp', label: 'штора' }, { value: 'fridge', label: 'реф' }, { value: 'flatbed', label: 'борт' },
                ]} />
              </Field>
            </div>
          </div>
        </AddButton>
      </div>
      <div className="c1-scroll min-h-0 flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr><th className="w-[200px]">Модель</th><th className="w-[120px]">Госномер</th><th>Тип</th></tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((t) => (
              <tr key={String(t.id)}><td>{asStr(t.model)}</td><td>{asStr(t.plate)}</td><td>{TRAILER_RU[String(t.type)] ?? asStr(t.type)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function DriversTab({ active }: { active: boolean }) {
  const { data } = usePoll<Rows>('/api/office/catalog/drivers', active ? 5000 : 3600000)
  return (
    <>
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <AddButton title="Новый водитель">
          <input type="hidden" name="__entity" value="drivers" />
          <div className="grid gap-3">
            <Field label="ФИО"><C1Input name="fullName" required placeholder="Иванов Иван Иванович" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Телефон"><C1Input name="phone" placeholder="+7 (___) ___-__-__" /></Field>
              <Field label="Номер ВУ"><C1Input name="licenseNo" placeholder="5412 000000" /></Field>
            </div>
            <Field label="appId (X-Driver-Id), необязательно"><C1Input name="appId" placeholder="UUID приложения водителя" /></Field>
          </div>
        </AddButton>
      </div>
      <div className="c1-scroll min-h-0 flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr><th className="w-[220px]">ФИО</th><th className="w-[150px]">Телефон</th><th className="w-[120px]">ВУ</th><th>appId</th></tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((d) => (
              <tr key={String(d.id)}>
                <td>{asStr(d.fullName)}</td>
                <td>{asStr(d.phone)}</td>
                <td>{asStr(d.licenseNo)}</td>
                <td className="max-w-[260px] text-[#8a8a8a]">{asStr(d.appId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ContractorsTab({ active }: { active: boolean }) {
  const { data } = usePoll<Rows>('/api/office/catalog/contractors', active ? 5000 : 3600000)
  return (
    <>
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <AddButton title="Новый контрагент">
          <input type="hidden" name="__entity" value="contractors" />
          <div className="grid gap-3">
            <Field label="Наименование"><C1Input name="name" required placeholder="ООО «Ромашка»" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ИНН"><C1Input name="inn" /></Field>
              <Field label="Роль">
                <C1Select name="kind" value="customer" options={[
                  { value: 'customer', label: 'заказчик' }, { value: 'shipper', label: 'грузоотправитель' }, { value: 'consignee', label: 'грузополучатель' },
                ]} />
              </Field>
            </div>
          </div>
        </AddButton>
      </div>
      <div className="c1-scroll min-h-0 flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr><th className="w-[260px]">Наименование</th><th className="w-[130px]">ИНН</th><th>Роль</th></tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((c) => (
              <tr key={String(c.id)}>
                <td>{asStr(c.name)}</td>
                <td>{asStr(c.inn)}</td>
                <td>{asStr(c.kind)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function LocationsTab({ active }: { active: boolean }) {
  const { data } = usePoll<Rows>('/api/office/catalog/locations', active ? 5000 : 3600000)
  return (
    <>
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <AddButton title="Новый пункт погрузки/выгрузки">
          <input type="hidden" name="__entity" value="locations" />
          <div className="grid gap-3">
            <Field label="Название"><C1Input name="name" required placeholder="Новороссийск, причал 27" /></Field>
            <Field label="Адрес"><C1Input name="address" required placeholder="г. Новороссийск, терминал" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Широта"><C1Input name="lat" type="number" step="0.000001" required /></Field>
              <Field label="Долгота"><C1Input name="lon" type="number" step="0.000001" required /></Field>
              <Field label="Геозона, м"><C1Input name="geofenceRadiusM" type="number" defaultValue="300" /></Field>
            </div>
          </div>
        </AddButton>
      </div>
      <div className="c1-scroll min-h-0 flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr><th className="w-[220px]">Название</th><th className="w-[240px]">Адрес</th><th className="w-[180px]">Координаты</th><th>Геозона</th></tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((l) => (
              <tr key={String(l.id)}>
                <td>{asStr(l.name)}</td>
                <td>{asStr(l.address)}</td>
                <td>{asStr(l.lat)}, {asStr(l.lon)}</td>
                <td>{asStr(l.geofenceRadiusM)} м</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
