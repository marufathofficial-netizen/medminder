import './globals.css'
export const metadata = { title: 'MedMinder', description: 'Medication adherence platform' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>)
}
