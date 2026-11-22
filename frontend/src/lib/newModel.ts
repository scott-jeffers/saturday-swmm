/** Open the New model dialog (held by App). */
export const openNewModel = () => window.dispatchEvent(new Event('saturday-swmm-new-model'))

/** A model just made should open the map in Edit mode, also in the viewer
 *  (which otherwise always opens in Results). Read once by the map page. */
let editNext = false
export const openMapInEditNext = () => {
  editNext = true
  window.dispatchEvent(new CustomEvent('saturday-swmm-map-mode', { detail: 'edit' }))
}
export const takeEditNext = () => {
  const v = editNext
  editNext = false
  return v
}
