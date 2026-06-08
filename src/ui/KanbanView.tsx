import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  useDroppable, type DragEndEvent,
} from "@dnd-kit/core";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus, Trash2, GripVertical,
  Eye, EyeOff, Circle, Clock, AlertTriangle,
} from "lucide-react";
import { api } from "./api";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

type TodoCard = {
  id: number;
  title: string;
  notes: string;
  priority: number;
  dueDate: string | null;
  doneAt: string | null;
  position: number;
};

type KanbanColumn = {
  id: number;
  name: string;
  isDoneColumn: boolean;
  cards: TodoCard[];
};

type ViewState = { type: "card"; columnId: number; card: TodoCard | null } | null;

function KanbanColumnHeader({
  col, editColumnId, editColumnName, onStartEdit, onSave, onChange, saving,
  onAddCard, onDeleteColumn,
}: {
  col: KanbanColumn; editColumnId: number | null; editColumnName: string;
  onStartEdit: (id: number, name: string) => void; onSave: () => void;
  onChange: (val: string) => void; saving: boolean;
  onAddCard: () => void; onDeleteColumn: () => void;
}) {
  return (
    <div className="kanban-column-header">
      {editColumnId === col.id ? (
        <form className="kanban-column-edit" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <input
            className="kanban-column-input"
            value={editColumnName}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onSave}
            onKeyDown={(e) => { if (e.key === "Escape") onSave(); }}
            autoFocus
          />
          {saving && <span className="kanban-saving">...</span>}
        </form>
      ) : (
        <span
          className="kanban-column-name"
          onDoubleClick={() => onStartEdit(col.id, col.name)}
          title="Duplo clique para renomear"
        >
          {col.name}
          <span className="kanban-column-count">{col.cards.length}</span>
        </span>
      )}
      <div className="kanban-column-actions">
        <button className="kanban-column-btn" title="Adicionar card" onClick={onAddCard}>
          <Plus size={14} />
        </button>
        {col.cards.length === 0 && (
          <button className="kanban-column-btn kanban-column-btn-danger" title="Excluir coluna" onClick={onDeleteColumn}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function DroppableCardsArea({ colId, children, empty }: { colId: number; children: React.ReactNode; empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${colId}` });
  return (
    <div
      ref={setNodeRef}
      className={`kanban-cards${isOver ? " droppable-over" : ""}${empty ? " kanban-cards-empty" : ""}`}
    >
      {children}
      {empty && <div className="kanban-column-empty">Vazio &mdash; arraste cards para aqui ou crie um novo.</div>}
    </div>
  );
}

function SortableCard({ card, columnId, onClick }: { card: TodoCard; columnId: number; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card-${card.id}`,
    data: { type: "card", cardId: card.id, columnId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const priorityColors: Record<number, string> = { 0: "var(--muted, #94a3b8)", 1: "#f59e0b", 2: "#dc2626" };
  const priorityLabels: Record<number, string> = { 0: "", 1: "Alta", 2: "Urgente" };
  const isOverdue = card.dueDate && !card.doneAt && card.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <div ref={setNodeRef} style={style} className={`kanban-card${card.doneAt ? " done" : ""}`} onClick={onClick}>
      <div className="kanban-card-header">
        <span className="kanban-card-priority" style={{ backgroundColor: priorityColors[card.priority] }} title={priorityLabels[card.priority] || "Normal"} />
        <span className="kanban-card-title">{card.title}</span>
        <button className="kanban-card-grab" {...attributes} {...listeners} title="Arrastar para mover">
          <GripVertical size={14} />
        </button>
      </div>
      <div className="kanban-card-meta">
        {card.priority > 0 && (
          <span className={`kanban-badge priority-${card.priority}`}>
            {card.priority === 2 ? <AlertTriangle size={10} /> : <Circle size={10} />}
            {priorityLabels[card.priority]}
          </span>
        )}
        {card.dueDate && (
          <span className={`kanban-badge${isOverdue ? " overdue" : " due-date"}`}>
            <Clock size={10} />
            {new Date(card.dueDate + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
          </span>
        )}
        {card.doneAt && (
          <span className="kanban-badge done-badge">
            {new Date(card.doneAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
          </span>
        )}
      </div>
    </div>
  );
}

export function KanbanView() {
  const queryClient = useQueryClient();
  const [showDone, setShowDone] = useState(true);
  const [view, setView] = useState<ViewState>(null);
  const [editColumnId, setEditColumnId] = useState<number | null>(null);
  const [editColumnName, setEditColumnName] = useState("");
  const [newColumnName, setNewColumnName] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "card" | "column"; id: number; name: string } | null>(null);
  const [message, setMessage] = useState("");

  const board = useQuery({
    queryKey: ["todo-board", showDone],
    queryFn: () => api<KanbanColumn[]>(`/todo-board?showDone=${showDone ? 1 : 0}`),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const createCardMutation = useMutation({
    mutationFn: (body: unknown) => api("/todos", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["todo-board"] }); setView(null); },
  });
  const updateCardMutation = useMutation({
    mutationFn: (params: { id: number; body: unknown }) => api(`/todos/${params.id}`, { method: "PUT", body: JSON.stringify(params.body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["todo-board"] }); setView(null); },
  });
  const moveCardMutation = useMutation({
    mutationFn: (params: { id: number; body: { columnId: number; position: number } }) =>
      api(`/todos/${params.id}/move`, { method: "PUT", body: JSON.stringify(params.body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["todo-board"] }),
  });
  const deleteCardMutation = useMutation({
    mutationFn: (id: number) => api(`/todos/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["todo-board"] }); setDeleteTarget(null); setMessage("Card excluido."); },
  });
  const deleteColumnMutation = useMutation({
    mutationFn: (id: number) => api(`/todo-columns/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["todo-board"] }); setDeleteTarget(null); setMessage("Coluna excluida."); },
    onError: (err: Error) => { setMessage(err.message); setDeleteTarget(null); },
  });
  const createColumnMutation = useMutation({
    mutationFn: (name: string) => api("/todo-columns", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["todo-board"] }); setNewColumnName(null); },
  });
  const updateColumnMutation = useMutation({
    mutationFn: (params: { id: number; name: string }) =>
      api(`/todo-columns/${params.id}`, { method: "PUT", body: JSON.stringify({ name: params.name }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["todo-board"] }); setEditColumnId(null); },
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current;
    if (activeData?.type !== "card") return;
    const cardId = activeData.cardId as number;
    const overId = String(over.id);

    let targetColumnId: number;
    let position = 0;

    if (overId.startsWith("column-")) {
      targetColumnId = Number(overId.replace("column-", ""));
      const targetCards = board.data?.find((c) => c.id === targetColumnId)?.cards ?? [];
      position = targetCards.length;
    } else if (overId.startsWith("card-")) {
      const overData = over.data.current as { columnId: number } | undefined;
      targetColumnId = overData?.columnId ?? 0;
      const targetCards = board.data?.find((c) => c.id === targetColumnId)?.cards ?? [];
      const overCardId = Number(overId.replace("card-", ""));
      position = targetCards.findIndex((c) => c.id === overCardId);
      if (position < 0) position = targetCards.length;
    } else {
      return;
    }

    if (!targetColumnId) return;
    moveCardMutation.mutate({ id: cardId, body: { columnId: targetColumnId, position } });
  }

  function handleSaveColumnName() {
    if (editColumnId === null) return;
    const name = editColumnName.trim();
    if (name) {
      updateColumnMutation.mutate({ id: editColumnId, name });
    } else {
      setEditColumnId(null);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>To-Dos</h1>
          <p>Kanban de tarefas e ideias.</p>
        </div>
      </header>

      {message && (
        <div className="notification">
          <span>{message}</span>
          <button type="button" className="ghost" onClick={() => setMessage("")}>Fechar</button>
        </div>
      )}

      <div className="toolbar">
        <button type="button" className={!showDone ? "active" : ""} onClick={() => setShowDone(!showDone)} title={showDone ? "Ocultar concluidos" : "Mostrar concluidos"}>
          {showDone ? <EyeOff size={15} /> : <Eye size={15} />}
          {showDone ? "Ocultar" : "Mostrar"} concluidos
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="kanban-board">
          {board.data?.map((col) => {
            const cardIds = col.cards.map((c) => `card-${c.id}`);
            return (
              <div key={col.id} className="kanban-column">
                <KanbanColumnHeader
                  col={col}
                  editColumnId={editColumnId}
                  editColumnName={editColumnName}
                  onStartEdit={(id, name) => { setEditColumnId(id); setEditColumnName(name); }}
                  onSave={handleSaveColumnName}
                  onChange={setEditColumnName}
                  saving={updateColumnMutation.isPending}
                  onAddCard={() => setView({ type: "card", columnId: col.id, card: null })}
                  onDeleteColumn={() => setDeleteTarget({ type: "column", id: col.id, name: col.name })}
                />
                <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
                  <DroppableCardsArea colId={col.id} empty={col.cards.length === 0}>
                    {col.cards.map((card) => (
                      <SortableCard
                        key={card.id}
                        card={card}
                        columnId={col.id}
                        onClick={() => setView({ type: "card", columnId: col.id, card })}
                      />
                    ))}
                  </DroppableCardsArea>
                </SortableContext>
              </div>
            );
          })}

          <div className="kanban-column kanban-column-new">
            {newColumnName !== null ? (
              <form className="kanban-column-edit" style={{ padding: "12px" }} onSubmit={(e) => {
                e.preventDefault();
                if (newColumnName.trim()) createColumnMutation.mutate(newColumnName.trim());
                else setNewColumnName(null);
              }}>
                <input
                  className="kanban-column-input"
                  placeholder="Nome da coluna..."
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  onBlur={() => { if (!newColumnName.trim()) setNewColumnName(null); }}
                  onKeyDown={(e) => { if (e.key === "Escape") setNewColumnName(null); }}
                  autoFocus
                />
              </form>
            ) : (
              <button className="kanban-add-column" onClick={() => setNewColumnName("")}>
                <Plus size={16} /> Nova coluna
              </button>
            )}
          </div>
        </div>
      </DndContext>

      {view?.type === "card" && (
        <CardModal
          card={view.card}
          onSave={(data) => {
            if (view.card) {
              updateCardMutation.mutate({ id: view.card.id, body: data });
            } else {
              createCardMutation.mutate({ columnId: view.columnId, ...data });
            }
          }}
          onDelete={view.card ? () => {
            setView(null);
            setDeleteTarget({ type: "card", id: view.card!.id, name: view.card!.title });
          } : undefined}
          onClose={() => setView(null)}
          saving={createCardMutation.isPending || updateCardMutation.isPending}
        />
      )}

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={deleteTarget?.type === "card" ? "Excluir Card" : "Excluir Coluna"}
        entityName={deleteTarget?.name ?? ""}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "card") deleteCardMutation.mutate(deleteTarget.id);
          else deleteColumnMutation.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

function CardModal({
  card, onSave, onDelete, onClose, saving,
}: {
  card: TodoCard | null;
  onSave: (data: { title: string; notes: string; priority: number; dueDate: string | null }) => void;
  onDelete?: () => void; onClose: () => void; saving: boolean;
}) {
  const [title, setTitle] = useState(card?.title ?? "");
  const [notes, setNotes] = useState(card?.notes ?? "");
  const [priority, setPriority] = useState(card?.priority ?? 0);
  const [dueDate, setDueDate] = useState(card?.dueDate ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), notes: notes.trim(), priority, dueDate: dueDate || null });
  }

  const priorities = [
    { value: 0, label: "Baixa", color: "#059669", bg: "#ecfdf5" },
    { value: 1, label: "Media", color: "#d97706", bg: "#fffbeb" },
    { value: 2, label: "Alta",  color: "#dc2626", bg: "#fef2f2" },
  ];

  return (
    <div className="todo-modal-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="todo-modal" role="document">
        <div className="todo-modal-header">
          <h2>{card ? "Editar tarefa" : "Nova tarefa"}</h2>
          <button type="button" className="todo-modal-close" onClick={onClose} aria-label="Fechar">&times;</button>
        </div>

        <form className="todo-modal-body" onSubmit={submit} noValidate>
          <div className="todo-modal-field">
            <label htmlFor="todo-title">Titulo</label>
            <input
              id="todo-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="O que precisa ser feito?"
              autoFocus
              required
            />
          </div>

          <div className="todo-modal-field">
            <label>Prioridade</label>
            <div className="todo-modal-priority" role="radiogroup" aria-label="Prioridade">
              {priorities.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={priority === p.value}
                  className={`todo-prio-btn${priority === p.value ? " selected" : ""}`}
                  style={{ "--prio-color": p.color, "--prio-bg": p.bg } as React.CSSProperties}
                  onClick={() => setPriority(p.value)}
                  tabIndex={priority === p.value ? 0 : -1}
                >
                  <span className="todo-prio-dot" style={{ backgroundColor: p.color }} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="todo-modal-field">
            <label htmlFor="todo-date">Data de vencimento</label>
            <input id="todo-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div className="todo-modal-field">
            <label htmlFor="todo-notes">Notas</label>
            <textarea
              id="todo-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalhes ou observacoes..."
              rows={3}
            />
          </div>

          {card?.doneAt && (
            <div className="todo-modal-done-info">
              Concluido em {new Date(card.doneAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          )}

          <div className="todo-modal-footer">
            <div className="todo-modal-footer-left">
              {onDelete && (
                <button type="button" className="todo-modal-btn-delete" onClick={onDelete}>
                  <Trash2 size={14} />
                  Excluir tarefa
                </button>
              )}
            </div>
            <div className="todo-modal-footer-right">
              <button type="button" className="todo-modal-btn-ghost" onClick={onClose}>Cancelar</button>
              <button type="submit" className="todo-modal-btn-primary" disabled={saving || !title.trim()}>
                {saving ? "Salvando..." : card ? "Salvar alteracoes" : "Criar tarefa"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
