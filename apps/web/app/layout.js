import './styles.css';

export const metadata = {
  title: 'Book of Life',
  description: 'Cloud-hosted journal entries with desktop-powered photo storage.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
