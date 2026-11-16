"use client";

import { useState } from "react";
import { useImportRows, useImportAction } from "@/hooks/use-imports";
import type { ImportJob, ImportRow } from "@/lib/import-contracts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loading, RequestError } from "@/components/request-feedback";

function CorrectRow({ job, row }: { job: ImportJob; row: ImportRow }) {
  const [open, setOpen] = useState(false);
  const [cells, setCells] = useState<string[]>([]);
  const action = useImportAction(job.id);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!action.isPending) {
          setOpen(value);
          setCells(
            job.headers.map(
              (_, index) => (row.corrected_cells ?? row.cells)[index] ?? "",
            ),
          );
          action.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Correct row {row.row_number}
        </Button>
      </DialogTrigger>
      <DialogContent className="import-workspace max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correct row {row.row_number}</DialogTitle>
          <DialogDescription>
            {row.error ??
              "Edit the source values and return this row to the processing queue."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate(
              { action: "correct", number: row.row_number, cells },
              { onSuccess: () => setOpen(false) },
            );
          }}
        >
          <FieldGroup>
            {job.headers.map((header, index) => (
              <Field key={header}>
                <FieldLabel htmlFor={`cell-${index}`}>{header}</FieldLabel>
                <Input
                  id={`cell-${index}`}
                  value={cells[index] ?? ""}
                  maxLength={16384}
                  disabled={action.isPending}
                  onChange={(event) =>
                    setCells(
                      cells.map((cell, position) =>
                        position === index ? event.target.value : cell,
                      ),
                    )
                  }
                />
              </Field>
            ))}
          </FieldGroup>
          {action.error && <RequestError error={action.error} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={action.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={action.isPending}>
              {action.isPending ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ImportRows({ job }: { job: ImportJob }) {
  const [cursors, setCursors] = useState([0]);
  const rows = useImportRows(job.id, cursors[cursors.length - 1]);

  return (
    <section
      className="flex min-w-0 flex-col gap-4"
      aria-labelledby="rows-heading"
    >
      <div>
        <h2 id="rows-heading" className="text-xl font-semibold">
          Source records
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Inspect source values and correct rejected records. Saved corrections
          are imported automatically.
        </p>
      </div>
      {rows.error ? (
        <RequestError
          error={rows.error}
          retry={() => {
            void rows.refetch();
          }}
        />
      ) : !rows.data ? (
        <Loading />
      ) : (
        <>
          <Table>
            <TableCaption>
              {rows.data.length
                ? `Page ${cursors.length} · ${rows.data.length} records`
                : "No records on this page."}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Status</TableHead>
                {job.headers.map((header) => (
                  <TableHead key={header}>{header}</TableHead>
                ))}
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.map((row) => (
                <TableRow key={row.row_number}>
                  <TableCell className="tabular-nums">
                    {row.row_number}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.state === "rejected" ? "destructive" : "secondary"
                      }
                    >
                      {row.state}
                    </Badge>
                  </TableCell>
                  {job.headers.map((header, index) => (
                    <TableCell key={header}>
                      <span className="block max-w-64 whitespace-normal break-words">
                        {(row.corrected_cells ?? row.cells)[index] ?? "—"}
                      </span>
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className="flex max-w-xs flex-col gap-2 whitespace-normal">
                      {row.error && (
                        <p className="text-sm text-destructive">{row.error}</p>
                      )}
                      {row.state === "rejected" && (
                        <CorrectRow job={job} row={row} />
                      )}
                      {row.result_id && (
                        <span className="text-xs break-all text-muted-foreground">
                          Record: {row.result_id}
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={cursors.length === 1 || rows.isFetching}
              onClick={() => setCursors(cursors.slice(0, -1))}
            >
              Previous records
            </Button>
            <Button
              variant="outline"
              disabled={rows.data.length < 20 || rows.isFetching}
              onClick={() =>
                setCursors([
                  ...cursors,
                  rows.data![rows.data!.length - 1].row_number,
                ])
              }
            >
              Next records
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
