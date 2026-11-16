import { UploadMinimalisticIcon as Upload } from "@solar-icons/react/linear/upload-minimalistic";

export function UploadForm({
  label,
  accept,
  busy,
  submit,
}: {
  label: string;
  accept: string;
  busy: boolean;
  submit: (f: FormData) => Promise<void>;
}) {
  return (
    <form
      className="upload-zone"
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
    >
      <Upload size={22} />
      <strong>{label}</strong>
      <input type="file" name="file" accept={accept} required />
      <button className="secondary" disabled={busy}>
        Subir archivo
      </button>
    </form>
  );
}
