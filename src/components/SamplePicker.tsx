import { recordSamples } from '../data/sampleRecords'
import type { SampleId } from '../data/sampleRecords'
import { Icon } from './Icon'

interface SamplePickerProps {
  selectedId: SampleId
  onSelect: (id: SampleId) => void
}

export function SamplePicker({ selectedId, onSelect }: SamplePickerProps) {
  return (
    <section className="sample-section" aria-labelledby="sample-heading">
      <div className="section-heading"><h2 id="sample-heading">選取模擬紀錄</h2><span className="quiet-count">7 組樣本</span></div>
      <p className="section-description">選擇一種情境，觀察學分採計的差異。</p>
      <div className="sample-list" role="group" aria-label="模擬修課紀錄樣本">
        {recordSamples.map((sample, index) => (
          <button key={sample.id} type="button" className={`sample-button ${selectedId === sample.id ? 'is-selected' : ''}`} aria-pressed={selectedId === sample.id} onClick={() => onSelect(sample.id)}>
            <span className="sample-number">{index + 1}</span>
            <span className="sample-copy"><span className="sample-name">{sample.name}</span><span className="sample-description">{sample.description}</span></span>
            {selectedId === sample.id && <Icon name="check" className="sample-check" />}
          </button>
        ))}
      </div>
    </section>
  )
}
