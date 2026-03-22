import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Send, Search, CheckCircle2, Circle, Lightbulb, CheckSquare, Star, Clock, Trash2, Languages, Sun, Moon, GripVertical, Folder, Plus, FolderOpen, FileDown, FileUp, Edit2, RefreshCw, Sparkles, Check, X, Paperclip, LogOut, LogIn, Copy, Filter, Link as LinkIcon, Calendar, Globe } from 'lucide-react';
import { Item, TaskItem, IdeaItem, Project } from './types';
import { categorizeMessage } from './services/gemini';
import { useLocalStorage } from './hooks/useLocalStorage';
import { auth, db, storage, signInWithGoogle, logOut, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, writeBatch, deleteField } from 'firebase/firestore';

const t = {
  en: {
    subtitle: "AI Idea & Task Organizer",
    search: "Search items...",
    all: "All",
    tasks: "Tasks",
    ideas: "Ideas",
    emptyTasks: "No tasks yet. Send a message below to create one!",
    emptyIdeas: "No ideas yet. Brainstorm by sending a message below!",
    inputPlaceholder: "Type a thought, task, or idea...",
    footer: "Powered by Gemini AI. Messages are processed and categorized instantly.",
    projects: "Projects",
    newProject: "New project...",
    inbox: "Inbox",
    deleteProject: "Delete project",
    aiToggle: "AI Processing",
    exportTxt: "Export .txt",
    importTxt: "Import .txt",
    convert: "Convert",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    copied: "Copied to clipboard!",
    attachFile: "Attach file",
    login: "Sign in with Google",
    logout: "Sign out",
    welcome: "Welcome to thnk",
    searchGlobal: "Search everywhere...",
    globalSearchActive: "Global search (click to switch to project)",
    localSearchActive: "Project search (click to switch to global)"
  },
  ru: {
    subtitle: "ИИ-Органайзер Идей и Задач",
    search: "Поиск...",
    all: "Все",
    tasks: "Задачи",
    ideas: "Идеи",
    emptyTasks: "Пока нет задач. Отправьте сообщение ниже, чтобы создать!",
    emptyIdeas: "Пока нет идей. Отправьте сообщение ниже для мозгового штурма!",
    inputPlaceholder: "Напишите мысль, задачу или идею...",
    footer: "Работает на Gemini AI. Сообщения обрабатываются и классифицируются мгновенно.",
    projects: "Проекты",
    newProject: "Новый проект...",
    inbox: "Входящие",
    deleteProject: "Удалить проект",
    aiToggle: "ИИ-обработка",
    exportTxt: "Экспорт .txt",
    importTxt: "Импорт .txt",
    convert: "Конвертировать",
    edit: "Редактировать",
    save: "Сохранить",
    cancel: "Отмена",
    copied: "Скопировано в буфер!",
    attachFile: "Прикрепить файл",
    login: "Войти через Google",
    logout: "Выйти",
    welcome: "Добро пожаловать в thnk",
    searchGlobal: "Поиск везде...",
    globalSearchActive: "Глобальный поиск (нажмите для поиска по проекту)",
    localSearchActive: "Поиск по проекту (нажмите для глобального поиска)"
  }
};

const isImage = (filename: string) => /\.(jpe?g|png|gif|webp|svg|bmp|heic|heif)/i.test(filename);

const getCleanFileUrl = (url: string) => {
  const match = url.match(/https:\/\/ucarecdn\.com\/([a-f0-9-]+)/);
  return match ? `https://ucarecdn.com/${match[1]}/` : url;
};

const renderTextWithLinks = (text: string) => {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] dark:text-[#8ab4f8] hover:underline break-all" onClick={(e) => e.stopPropagation()}>
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  
  const [activeProjectId, setActiveProjectId] = useLocalStorage<string>('brainboard-active-project', 'default');
  const [language, setLanguage] = useLocalStorage<'en' | 'ru'>('brainboard-lang', 'en');
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('brainboard-theme', 'light');
  const [isAiEnabled, setIsAiEnabled] = useLocalStorage('brainboard-ai-enabled', true);
  
  const [inputValue, setInputValue] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGlobalSearch, setIsGlobalSearch] = useState(false);
  const [filterCategory, setFilterCategory] = useState<'All' | 'Task' | 'Idea'>('All');
  const [showFilters, setShowFilters] = useState(false);
  const [filterHasFile, setFilterHasFile] = useState(false);
  const [filterHasLink, setFilterHasLink] = useState(false);
  const [filterTime, setFilterTime] = useState<'all' | 'today' | 'week' | 'month'>('all');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    item: Item | null;
  }>({ visible: false, x: 0, y: 0, item: null });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      setContextMenu(prev => ({ ...prev, visible: false }));
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user) return;

    const qProjects = query(collection(db, 'projects'), where('uid', '==', user.uid));
    const unsubProjects = onSnapshot(qProjects, (snapshot) => {
      const projs: Project[] = [];
      snapshot.forEach(doc => projs.push(doc.data() as Project));
      setProjects(projs.sort((a, b) => a.createdAt - b.createdAt));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'projects'));

    const qItems = query(collection(db, 'items'), where('uid', '==', user.uid));
    const unsubItems = onSnapshot(qItems, (snapshot) => {
      const itms: Item[] = [];
      snapshot.forEach(doc => itms.push(doc.data() as Item));
      setItems(itms.sort((a, b) => a.createdAt - b.createdAt));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'items'));

    return () => {
      unsubProjects();
      unsubItems();
    };
  }, [user, isAuthReady]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Ignore if user is typing in an input/textarea (except our main chat input which handles it itself)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        setAttachedFile(e.clipboardData.files[0]);
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !user) return;
    
    const newProject: Project = {
      id: crypto.randomUUID(),
      uid: user.uid,
      name: newProjectName.trim(),
      createdAt: Date.now()
    };
    
    try {
      await setDoc(doc(db, 'projects', newProject.id), newProject);
      setActiveProjectId(newProject.id);
      setNewProjectName('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    }
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (id === 'default' || !user) return;
    
    if (window.confirm(language === 'en' ? 'Delete this project and all its items?' : 'Удалить этот проект и все его элементы?')) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'projects', id));
        
        const projectItems = items.filter(i => i.projectId === id);
        projectItems.forEach(item => {
          batch.delete(doc(db, 'items', item.id));
        });
        
        await batch.commit();
        
        if (activeProjectId === id) {
          setActiveProjectId('default');
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'projects/items');
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedFile(file);
    e.target.value = '';
  };

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && !attachedFile) || isProcessing || !user) return;

    const message = inputValue.trim() || (attachedFile ? `Attached file: ${attachedFile.name}` : '');
    setInputValue('');
    setIsProcessing(true);

    try {
      let attachmentData;
      if (attachedFile) {
        // Firestore has a 1MB document limit. We limit files to ~700KB to be safe after base64 encoding.
        const MAX_FILE_SIZE = 700 * 1024; // 700 KB
        if (attachedFile.size > MAX_FILE_SIZE) {
          throw new Error(
            language === 'en' 
              ? 'File is too large. Maximum size for database storage is 700KB.' 
              : 'Файл слишком большой. Максимальный размер для сохранения в базу — 700 КБ.'
          );
        }

        showToast(language === 'en' ? 'Processing file...' : 'Обработка файла...');
        
        try {
          const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(attachedFile);
          });
          
          attachmentData = { name: attachedFile.name, url: base64Data };
        } catch (error) {
          console.error('File read failed:', error);
          throw new Error(
            language === 'en' ? 'Failed to read file.' : 'Ошибка чтения файла.'
          );
        }
      }

      let result;
      if (isAiEnabled) {
        result = await categorizeMessage(message, language);
      } else {
        result = {
          title: message.length > 50 ? message.substring(0, 50) + '...' : message,
          description: message,
          category: 'Task' as const,
          priority: 3
        };
      }
      
      const newItem: any = {
        id: crypto.randomUUID(),
        uid: user.uid,
        projectId: activeProjectId,
        rawMessage: message,
        title: result.title,
        description: result.description,
        category: result.category,
        createdAt: Date.now(),
      };

      if (attachmentData) {
        newItem.attachment = attachmentData;
      }

      if (result.category === 'Task') {
        (newItem as TaskItem).isDone = false;
      } else {
        (newItem as IdeaItem).priority = result.priority || 3;
        (newItem as IdeaItem).rating = 0;
      }

      await setDoc(doc(db, 'items', newItem.id), newItem);
      setAttachedFile(null);
    } catch (error: any) {
      console.error('Error processing message:', error);
      showToast(error.message || 'Failed to process message. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleTaskStatus = async (id: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'items', id), { isDone: !currentStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'items');
    }
  };

  const updateIdeaRating = async (id: string, rating: number) => {
    try {
      await updateDoc(doc(db, 'items', id), { rating });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'items');
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'items', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'items');
    }
  };

  const convertItem = async (item: Item) => {
    try {
      if (item.category === 'Task') {
        await updateDoc(doc(db, 'items', item.id), {
          category: 'Idea',
          priority: 3,
          rating: 0,
          isDone: deleteField()
        });
      } else {
        await updateDoc(doc(db, 'items', item.id), {
          category: 'Task',
          isDone: false,
          priority: deleteField(),
          rating: deleteField()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'items');
    }
  };

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditDesc(item.description);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await updateDoc(doc(db, 'items', editingId), {
        title: editTitle.trim() || 'Untitled',
        description: editDesc
      });
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'items');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, item: Item) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      item
    });
  };

  const exportToTxt = () => {
    const projectItems = items.filter(i => (i.projectId || 'default') === activeProjectId);
    const text = projectItems.map(i => `[${i.category}] ${i.title}\n${i.description}\n---`).join('\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-${activeProjectId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFromTxt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const blocks = text.split('---').map(b => b.trim()).filter(b => b);
      
      const batch = writeBatch(db);
      
      blocks.forEach(block => {
         const lines = block.split('\n');
         const firstLine = lines[0] || '';
         const category = firstLine.startsWith('[Idea]') ? 'Idea' : 'Task';
         const title = firstLine.replace(/\[.*?\]\s*/, '').trim();
         const description = lines.slice(1).join('\n').trim();
         
         const id = crypto.randomUUID();
         const newItem: any = {
           id,
           uid: user.uid,
           projectId: activeProjectId,
           rawMessage: block,
           title: title || 'Imported Item',
           description,
           category,
           createdAt: Date.now(),
         };
         
         if (category === 'Task') {
           newItem.isDone = false;
         } else {
           newItem.priority = 3;
           newItem.rating = 0;
         }
         
         batch.set(doc(db, 'items', id), newItem);
      });
      
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'items');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleReorderTasks = (newTasks: TaskItem[]) => {
    // Reordering in Firestore requires updating a sort order field. 
    // For simplicity, we'll just skip persisting reorder to DB in this demo, 
    // or update createdAt to match the new order.
    // Let's just update the local state for now, or update createdAt.
    // Updating createdAt is a simple hack to persist order.
    if (searchQuery) return;
    
    // To persist order, we can update the createdAt timestamps slightly
    const batch = writeBatch(db);
    const baseTime = Date.now();
    newTasks.forEach((task, index) => {
      batch.update(doc(db, 'items', task.id), { createdAt: baseTime + index });
    });
    batch.commit().catch(e => console.error(e));
  };

  const handleReorderIdeas = (newIdeas: IdeaItem[]) => {
    if (searchQuery) return;
    
    const batch = writeBatch(db);
    const baseTime = Date.now();
    newIdeas.forEach((idea, index) => {
      batch.update(doc(db, 'items', idea.id), { createdAt: baseTime + index });
    });
    batch.commit().catch(e => console.error(e));
  };

  if (!isAuthReady) {
    return <div className="flex h-screen items-center justify-center bg-[#f8f9fa] dark:bg-[#202124]"><div className="w-8 h-8 border-4 border-[#1a73e8] border-t-transparent rounded-full animate-spin"></div></div>;
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8f9fa] dark:bg-[#202124] text-[#202124] dark:text-[#e8eaed] font-sans transition-colors duration-200">
        <div className="max-w-md w-full p-8 bg-white dark:bg-[#28292c] rounded-[24px] shadow-sm border border-[#dadce0] dark:border-[#3c4043] text-center">
          <div className="w-16 h-16 bg-[#1a73e8] dark:bg-[#8ab4f8] rounded-2xl flex items-center justify-center text-white dark:text-[#202124] shadow-sm mx-auto mb-6 overflow-hidden">
            <img src="/logo.jpg" alt="thnk logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold mb-2">{t[language].welcome}</h1>
          <p className="text-[#5f6368] dark:text-[#9aa0a6] mb-8">{t[language].subtitle}</p>
          <button
            onClick={signInWithGoogle}
            className="w-full py-3 px-4 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-full font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <LogIn size={20} />
            {t[language].login}
          </button>
        </div>
      </div>
    );
  }

  const projectItems = items.filter(item => (item.projectId || 'default') === activeProjectId);

  const baseItems = (isGlobalSearch && searchQuery.trim() !== '') ? items : projectItems;

  const filteredItems = baseItems.filter((item) => {
    const matchesSearch = 
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.rawMessage.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.attachment?.name.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    
    const matchesCategory = filterCategory === 'All' || item.category === filterCategory;
    
    if (!matchesSearch || !matchesCategory) return false;

    if (filterHasFile && !item.attachment) return false;
    
    if (filterHasLink) {
      const hasUrl = /(https?:\/\/[^\s]+)/g.test(item.rawMessage || '') || /(https?:\/\/[^\s]+)/g.test(item.description || '');
      if (!hasUrl && !item.attachment?.url) return false;
    }

    if (filterTime !== 'all') {
      const now = Date.now();
      const itemDate = item.createdAt;
      const oneDay = 24 * 60 * 60 * 1000;
      if (filterTime === 'today' && now - itemDate > oneDay) return false;
      if (filterTime === 'week' && now - itemDate > 7 * oneDay) return false;
      if (filterTime === 'month' && now - itemDate > 30 * oneDay) return false;
    }

    return true;
  });

  const tasks = filteredItems.filter((item) => item.category === 'Task') as TaskItem[];
  const ideas = filteredItems.filter((item) => item.category === 'Idea') as IdeaItem[];

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  };

  const allProjects = [{ id: 'default', uid: user.uid, name: 'Inbox', createdAt: 0 }, ...projects];
  const activeProjectName = allProjects.find(p => p.id === activeProjectId)?.name || t[language].inbox;

  return (
    <div className="flex h-screen bg-[#f8f9fa] dark:bg-[#202124] text-[#202124] dark:text-[#e8eaed] font-sans overflow-hidden transition-colors duration-200">
      
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-[#323232] dark:bg-[#e8eaed] text-white dark:text-[#202124] px-4 py-2 rounded-full shadow-md z-50 text-sm"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contextMenu.visible && contextMenu.item && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            style={{ top: Math.min(contextMenu.y, window.innerHeight - 150), left: Math.min(contextMenu.x, window.innerWidth - 200) }}
            className="fixed z-50 w-48 bg-white dark:bg-[#28292c] rounded-lg shadow-xl border border-[#dadce0] dark:border-[#3c4043] py-1 overflow-hidden"
          >
            <button
              onClick={() => {
                const text = `${contextMenu.item!.title}\n\n${contextMenu.item!.description}`;
                navigator.clipboard.writeText(text);
                showToast(t[language].copied);
              }}
              className="w-full text-left px-4 py-2 text-sm text-[#202124] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] flex items-center gap-2 transition-colors"
            >
              <Copy size={14} />
              {language === 'en' ? 'Copy' : 'Скопировать'}
            </button>
            <button
              onClick={() => startEdit(contextMenu.item!)}
              className="w-full text-left px-4 py-2 text-sm text-[#202124] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] flex items-center gap-2 transition-colors"
            >
              <Edit2 size={14} />
              {t[language].edit}
            </button>
            <button
              onClick={() => convertItem(contextMenu.item!)}
              className="w-full text-left px-4 py-2 text-sm text-[#202124] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] flex items-center gap-2 transition-colors"
            >
              <RefreshCw size={14} />
              {language === 'en' ? (contextMenu.item!.category === 'Task' ? 'Move to Ideas' : 'Move to Tasks') : (contextMenu.item!.category === 'Task' ? 'Переместить в Идеи' : 'Переместить в Задачи')}
            </button>
            <div className="h-px bg-[#dadce0] dark:bg-[#3c4043] my-1"></div>
            <button
              onClick={() => deleteItem(contextMenu.item!.id)}
              className="w-full text-left px-4 py-2 text-sm text-[#ea4335] dark:text-[#f28b82] hover:bg-[#fce8e6] dark:hover:bg-[#5c2b29] flex items-center gap-2 transition-colors"
            >
              <Trash2 size={14} />
              {language === 'en' ? 'Delete' : 'Удалить'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar - Projects */}
      <div className="w-64 flex-shrink-0 bg-[#f8f9fa] dark:bg-[#202124] border-r border-[#dadce0] dark:border-[#3c4043] flex flex-col transition-colors duration-200">
        <div className="p-4 border-b border-[#dadce0] dark:border-[#3c4043] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm overflow-hidden bg-transparent">
              <img src="/logo.jpg" alt="thnk logo" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-[#202124] dark:text-[#e8eaed]">thnk</h1>
          </div>
        </div>
        
        <div className="py-4 flex-1 overflow-y-auto pr-2">
          <h2 className="px-4 text-xs font-bold text-[#5f6368] dark:text-[#9aa0a6] uppercase tracking-wider mb-3">
            {t[language].projects}
          </h2>
          
          <div className="space-y-1">
            {allProjects.map(project => {
              const isActive = activeProjectId === project.id;
              const isDefault = project.id === 'default';
              const displayName = isDefault && project.name === 'Inbox' ? t[language].inbox : project.name;
              
              return (
                <div
                  key={project.id}
                  onClick={() => setActiveProjectId(project.id)}
                  className={`group flex items-center justify-between pl-4 pr-3 py-2 rounded-r-full cursor-pointer transition-colors ${
                    isActive 
                      ? 'bg-[#e8f0fe] dark:bg-[#394457] text-[#1a73e8] dark:text-[#8ab4f8]' 
                      : 'text-[#5f6368] dark:text-[#9aa0a6] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043]'
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    {isActive ? <FolderOpen size={16} className="flex-shrink-0" /> : <Folder size={16} className="flex-shrink-0" />}
                    <span className="text-sm font-medium truncate">{displayName}</span>
                  </div>
                  {!isDefault && (
                    <button 
                      onClick={(e) => handleDeleteProject(project.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-[#80868b] hover:text-[#ea4335] transition-opacity"
                      title={t[language].deleteProject}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <form onSubmit={handleAddProject} className="mt-4 relative px-4">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t[language].newProject}
              className="w-full bg-transparent border-b border-[#dadce0] dark:border-[#3c4043] focus:border-[#1a73e8] dark:focus:border-[#8ab4f8] py-2 pr-8 text-sm outline-none transition-colors text-[#202124] dark:text-[#e8eaed] placeholder-[#80868b] dark:placeholder-[#9aa0a6]"
            />
            <button
              type="submit"
              disabled={!newProjectName.trim()}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#80868b] hover:text-[#1a73e8] dark:hover:text-[#8ab4f8] disabled:opacity-50 transition-colors"
            >
              <Plus size={16} />
            </button>
          </form>
        </div>
        
        <div className="p-4 border-t border-[#dadce0] dark:border-[#3c4043] flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-[#5f6368] dark:text-[#9aa0a6]">
            <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full bg-[#f1f3f4] dark:bg-[#3c4043]" />
            <span className="truncate flex-1 font-medium">{user.displayName || user.email}</span>
            <button onClick={logOut} title={t[language].logout} className="p-1.5 hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] rounded-full transition-colors"><LogOut size={16}/></button>
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
              className="p-2 text-[#5f6368] dark:text-[#9aa0a6] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] rounded-full transition-colors"
              title="Toggle Theme"
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button
              onClick={() => setLanguage(l => l === 'en' ? 'ru' : 'en')}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#5f6368] dark:text-[#e8eaed] bg-[#f1f3f4] dark:bg-[#3c4043] hover:bg-[#e8eaed] dark:hover:bg-[#5f6368] rounded-full transition-colors"
            >
              <Languages size={16} />
              {language === 'en' ? 'EN' : 'RU'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#28292c] overflow-hidden transition-colors duration-200">
        
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-[#dadce0] dark:border-[#3c4043] bg-white dark:bg-[#28292c] z-10 transition-colors duration-200">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-[#202124] dark:text-[#e8eaed] flex items-center gap-2">
              <FolderOpen size={20} className="text-[#1a73e8] dark:text-[#8ab4f8]" />
              {activeProjectName}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 mr-4 border-r border-[#dadce0] dark:border-[#3c4043] pr-4">
              <button onClick={exportToTxt} title={t[language].exportTxt} className="p-1.5 text-[#5f6368] dark:text-[#9aa0a6] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] rounded-full transition-colors">
                <FileDown size={18} />
              </button>
              <label title={t[language].importTxt} className="p-1.5 text-[#5f6368] dark:text-[#9aa0a6] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043] rounded-full cursor-pointer transition-colors">
                <FileUp size={18} />
                <input type="file" accept=".txt" className="hidden" onChange={importFromTxt} />
              </label>
            </div>
            <div className="relative flex items-center">
              <Search className="absolute left-3 text-[#5f6368] dark:text-[#9aa0a6]" size={18} />
              <input
                type="text"
                placeholder={isGlobalSearch ? t[language].searchGlobal : t[language].search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 py-2 bg-[#f1f3f4] dark:bg-[#202124] border-transparent rounded-full text-sm focus:bg-white dark:focus:bg-[#28292c] focus:border-[#1a73e8] dark:focus:border-[#8ab4f8] focus:ring-2 focus:ring-[#e8f0fe] dark:focus:ring-[#394457] transition-all w-64 text-[#202124] dark:text-[#e8eaed] placeholder-[#5f6368] dark:placeholder-[#9aa0a6]"
              />
              <button
                onClick={() => setIsGlobalSearch(!isGlobalSearch)}
                className={`absolute right-2 p-1.5 rounded-full transition-colors ${isGlobalSearch ? 'text-[#1a73e8] bg-[#e8f0fe] dark:bg-[#394457] dark:text-[#8ab4f8]' : 'text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-[#e8eaed]'}`}
                title={isGlobalSearch ? t[language].globalSearchActive : t[language].localSearchActive}
              >
                <Globe size={14} />
              </button>
            </div>

            <div className="relative" ref={filterRef}>
              <button 
                onClick={() => setShowFilters(!showFilters)}
                className={`p-2 rounded-full transition-colors ${showFilters || filterHasFile || filterHasLink || filterTime !== 'all' ? 'bg-[#e8f0fe] text-[#1a73e8] dark:bg-[#394457] dark:text-[#8ab4f8]' : 'text-[#5f6368] dark:text-[#9aa0a6] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043]'}`}
              >
                <Filter size={18} />
              </button>
              
              <AnimatePresence>
                {showFilters && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-[#28292c] rounded-2xl shadow-lg border border-[#dadce0] dark:border-[#3c4043] p-4 z-50"
                  >
                    <h3 className="text-sm font-semibold mb-3 text-[#202124] dark:text-[#e8eaed]">
                      {language === 'en' ? 'Filters' : 'Фильтры'}
                    </h3>
                    
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm text-[#5f6368] dark:text-[#9aa0a6] cursor-pointer">
                        <input type="checkbox" checked={filterHasFile} onChange={(e) => setFilterHasFile(e.target.checked)} className="rounded border-[#dadce0] text-[#1a73e8] focus:ring-[#1a73e8]" />
                        <Paperclip size={14} />
                        {language === 'en' ? 'Has Attachment' : 'С файлом'}
                      </label>
                      
                      <label className="flex items-center gap-2 text-sm text-[#5f6368] dark:text-[#9aa0a6] cursor-pointer">
                        <input type="checkbox" checked={filterHasLink} onChange={(e) => setFilterHasLink(e.target.checked)} className="rounded border-[#dadce0] text-[#1a73e8] focus:ring-[#1a73e8]" />
                        <LinkIcon size={14} />
                        {language === 'en' ? 'Has Link' : 'Со ссылкой'}
                      </label>
                      
                      <div className="pt-2 border-t border-[#f1f3f4] dark:border-[#3c4043]">
                        <div className="flex items-center gap-2 text-sm text-[#5f6368] dark:text-[#9aa0a6] mb-2">
                          <Calendar size={14} />
                          {language === 'en' ? 'Time' : 'Время'}
                        </div>
                        <select 
                          value={filterTime} 
                          onChange={(e) => setFilterTime(e.target.value as any)}
                          className="w-full text-sm bg-[#f8f9fa] dark:bg-[#202124] border border-[#dadce0] dark:border-[#3c4043] rounded-lg p-2 text-[#202124] dark:text-[#e8eaed]"
                        >
                          <option value="all">{language === 'en' ? 'All time' : 'За все время'}</option>
                          <option value="today">{language === 'en' ? 'Today' : 'За сегодня'}</option>
                          <option value="week">{language === 'en' ? 'This week' : 'За неделю'}</option>
                          <option value="month">{language === 'en' ? 'This month' : 'За месяц'}</option>
                        </select>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex bg-[#f1f3f4] dark:bg-[#202124] p-1 rounded-full transition-colors duration-200">
              {(['All', 'Task', 'Idea'] as const).map((cat) => {
                const labels = { All: t[language].all, Task: t[language].tasks, Idea: t[language].ideas };
                return (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                      filterCategory === cat 
                        ? 'bg-white dark:bg-[#3c4043] text-[#1a73e8] dark:text-[#8ab4f8] shadow-sm' 
                        : 'text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-[#e8eaed]'
                    }`}
                  >
                    {labels[cat]}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/* Boards Area */}
        <div className="flex-1 overflow-hidden flex bg-[#f8f9fa] dark:bg-[#202124] transition-colors duration-200">
          
          {/* Tasks Column */}
          {(filterCategory === 'All' || filterCategory === 'Task') && (
            <div className="flex-1 flex flex-col border-r border-[#dadce0] dark:border-[#3c4043] transition-colors duration-200">
              <div className="p-4 border-b border-[#dadce0] dark:border-[#3c4043] bg-white dark:bg-[#28292c] flex items-center justify-between transition-colors duration-200">
                <div className="flex items-center gap-2 text-[#1a73e8] dark:text-[#8ab4f8]">
                  <CheckSquare size={20} />
                  <h2 className="font-semibold">{t[language].tasks}</h2>
                </div>
                <span className="bg-[#e8f0fe] dark:bg-[#394457] text-[#1a73e8] dark:text-[#8ab4f8] text-xs font-bold px-2.5 py-1 rounded-full">
                  {tasks.length}
                </span>
              </div>
              <Reorder.Group axis="y" values={tasks} onReorder={handleReorderTasks} className="flex-1 overflow-y-auto p-4 space-y-4">
                <AnimatePresence>
                  {tasks.map((task) => (
                    <Reorder.Item
                      key={task.id}
                      value={task}
                      dragListener={!searchQuery && editingId !== task.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className={`bg-white dark:bg-[#28292c] p-4 rounded-2xl border shadow-sm transition-all duration-200 ${
                        task.isDone ? 'border-[#1a73e8]/30 dark:border-[#8ab4f8]/30 bg-[#e8f0fe]/50 dark:bg-[#394457]/50' : 'border-[#dadce0] dark:border-[#3c4043] hover:shadow-md hover:border-[#1a73e8] dark:hover:border-[#8ab4f8]'
                      } ${!searchQuery && editingId !== task.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        {!searchQuery && editingId !== task.id && (
                          <div className="mt-1 text-[#dadce0] dark:text-[#5f6368] hover:text-[#80868b] dark:hover:text-[#9aa0a6] transition-colors">
                            <GripVertical size={18} />
                          </div>
                        )}
                        <button 
                          onClick={() => toggleTaskStatus(task.id, task.isDone)}
                          className={`mt-0.5 flex-shrink-0 transition-colors ${task.isDone ? 'text-[#1a73e8] dark:text-[#8ab4f8]' : 'text-[#dadce0] dark:text-[#5f6368] hover:text-[#1a73e8] dark:hover:text-[#8ab4f8]'}`}
                        >
                          {task.isDone ? <CheckCircle2 size={22} /> : <Circle size={22} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          {editingId === task.id ? (
                            <div className="w-full">
                              <input 
                                value={editTitle} 
                                onChange={e => setEditTitle(e.target.value)} 
                                className="w-full mb-2 p-2 text-sm border rounded dark:bg-[#202124] dark:border-[#3c4043] dark:text-[#e8eaed]" 
                                autoFocus
                              />
                              <textarea 
                                value={editDesc} 
                                onChange={e => setEditDesc(e.target.value)} 
                                className="w-full p-2 text-sm border rounded dark:bg-[#202124] dark:border-[#3c4043] dark:text-[#e8eaed]" 
                                rows={3} 
                              />
                              <div className="flex gap-2 mt-2">
                                <button onClick={saveEdit} className="p-1.5 text-[#1a73e8] bg-[#e8f0fe] dark:bg-[#394457] hover:bg-[#d2e3fc] rounded"><Check size={16}/></button>
                                <button onClick={() => setEditingId(null)} className="p-1.5 text-[#ea4335] bg-[#fce8e6] dark:bg-[#5c2b29] hover:bg-[#fad2cf] rounded"><X size={16}/></button>
                              </div>
                            </div>
                          ) : (
                            <div onContextMenu={(e) => handleContextMenu(e, task)}>
                              <h3 className={`font-medium ${task.isDone ? 'line-through text-[#80868b] dark:text-[#9aa0a6]' : 'text-[#202124] dark:text-[#e8eaed]'}`}>
                                {task.title}
                              </h3>
                              <p className="text-sm text-[#5f6368] dark:text-[#9aa0a6] mt-1 whitespace-pre-wrap">{renderTextWithLinks(task.description)}</p>
                              
                              {task.attachment && (
                                <div className="mt-2 p-2 bg-[#f8f9fa] dark:bg-[#202124] rounded flex flex-col gap-2 text-sm border border-[#dadce0] dark:border-[#3c4043]">
                                  {isImage(task.attachment.name) && (
                                    <button onClick={() => setPreviewImage(getCleanFileUrl(task.attachment!.url))} className="block w-full max-w-sm overflow-hidden rounded border border-[#dadce0] dark:border-[#3c4043] text-left cursor-zoom-in">
                                      <img src={getCleanFileUrl(task.attachment.url)} alt={task.attachment.name} className="w-full h-auto object-cover hover:opacity-90 transition-opacity" referrerPolicy="no-referrer" />
                                    </button>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <Paperclip size={14} className="text-[#80868b]" />
                                    <a href={getCleanFileUrl(task.attachment.url)} target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] dark:text-[#8ab4f8] hover:underline truncate max-w-[200px]">
                                      {task.attachment.name}
                                    </a>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          
                          <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#f1f3f4] dark:border-[#3c4043]">
                            <div className="flex items-center gap-1.5 text-xs text-[#80868b] dark:text-[#9aa0a6]">
                              <Clock size={14} />
                              <span>{formatDate(task.createdAt)}</span>
                              {isGlobalSearch && searchQuery && (task.projectId || 'default') !== activeProjectId && (
                                <>
                                  <span className="mx-1">•</span>
                                  <Folder size={12} />
                                  <span className="truncate max-w-[100px]">
                                    {allProjects.find(p => p.id === (task.projectId || 'default'))?.name || t[language].inbox}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => startEdit(task)} title={t[language].edit} className="text-[#dadce0] dark:text-[#5f6368] hover:text-[#1a73e8] dark:hover:text-[#8ab4f8] transition-colors">
                                <Edit2 size={16} />
                              </button>
                              <button onClick={() => convertItem(task)} title={t[language].convert} className="text-[#dadce0] dark:text-[#5f6368] hover:text-[#fbbc04] dark:hover:text-[#fde293] transition-colors">
                                <RefreshCw size={16} />
                              </button>
                              <button onClick={() => deleteItem(task.id)} className="text-[#dadce0] dark:text-[#5f6368] hover:text-[#ea4335] dark:hover:text-[#f28b82] transition-colors">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Reorder.Item>
                  ))}
                </AnimatePresence>
                {tasks.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-[#80868b] dark:text-[#9aa0a6] p-8 text-center">
                    <CheckSquare size={48} className="mb-4 opacity-20" />
                    <p>{t[language].emptyTasks}</p>
                  </div>
                )}
              </Reorder.Group>
            </div>
          )}

          {/* Ideas Column */}
          {(filterCategory === 'All' || filterCategory === 'Idea') && (
            <div className="flex-1 flex flex-col transition-colors duration-200">
              <div className="p-4 border-b border-[#dadce0] dark:border-[#3c4043] bg-white dark:bg-[#28292c] flex items-center justify-between transition-colors duration-200">
                <div className="flex items-center gap-2 text-[#fbbc04] dark:text-[#fde293]">
                  <Lightbulb size={20} />
                  <h2 className="font-semibold">{t[language].ideas}</h2>
                </div>
                <span className="bg-[#fef7e0] dark:bg-[#423719] text-[#fbbc04] dark:text-[#fde293] text-xs font-bold px-2.5 py-1 rounded-full">
                  {ideas.length}
                </span>
              </div>
              <Reorder.Group axis="y" values={ideas} onReorder={handleReorderIdeas} className="flex-1 overflow-y-auto p-4 space-y-4">
                <AnimatePresence>
                  {ideas.map((idea) => (
                    <Reorder.Item
                      key={idea.id}
                      value={idea}
                      dragListener={!searchQuery && editingId !== idea.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className={`bg-white dark:bg-[#28292c] p-4 rounded-2xl border border-[#dadce0] dark:border-[#3c4043] shadow-sm hover:shadow-md hover:border-[#fbbc04] dark:hover:border-[#fde293] transition-all duration-200 ${!searchQuery && editingId !== idea.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        {!searchQuery && editingId !== idea.id && (
                          <div className="mt-1 text-[#dadce0] dark:text-[#5f6368] hover:text-[#80868b] dark:hover:text-[#9aa0a6] transition-colors">
                            <GripVertical size={18} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          {editingId === idea.id ? (
                            <div className="w-full">
                              <input 
                                value={editTitle} 
                                onChange={e => setEditTitle(e.target.value)} 
                                className="w-full mb-2 p-2 text-sm border rounded dark:bg-[#202124] dark:border-[#3c4043] dark:text-[#e8eaed]" 
                                autoFocus
                              />
                              <textarea 
                                value={editDesc} 
                                onChange={e => setEditDesc(e.target.value)} 
                                className="w-full p-2 text-sm border rounded dark:bg-[#202124] dark:border-[#3c4043] dark:text-[#e8eaed]" 
                                rows={3} 
                              />
                              <div className="flex gap-2 mt-2">
                                <button onClick={saveEdit} className="p-1.5 text-[#1a73e8] bg-[#e8f0fe] dark:bg-[#394457] hover:bg-[#d2e3fc] rounded"><Check size={16}/></button>
                                <button onClick={() => setEditingId(null)} className="p-1.5 text-[#ea4335] bg-[#fce8e6] dark:bg-[#5c2b29] hover:bg-[#fad2cf] rounded"><X size={16}/></button>
                              </div>
                            </div>
                          ) : (
                            <div onContextMenu={(e) => handleContextMenu(e, idea)}>
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-medium text-[#202124] dark:text-[#e8eaed]">{idea.title}</h3>
                                <span className="px-2 py-0.5 bg-[#fef7e0] dark:bg-[#423719] text-[#fbbc04] dark:text-[#fde293] text-[10px] font-bold rounded-full uppercase tracking-wider">
                                  P{idea.priority}
                                </span>
                              </div>
                              <p className="text-sm text-[#5f6368] dark:text-[#9aa0a6] mt-1 whitespace-pre-wrap">{renderTextWithLinks(idea.description)}</p>
                              
                              {idea.attachment && (
                                <div className="mt-2 p-2 bg-[#f8f9fa] dark:bg-[#202124] rounded flex flex-col gap-2 text-sm border border-[#dadce0] dark:border-[#3c4043]">
                                  {isImage(idea.attachment.name) && (
                                    <button onClick={() => setPreviewImage(getCleanFileUrl(idea.attachment!.url))} className="block w-full max-w-sm overflow-hidden rounded border border-[#dadce0] dark:border-[#3c4043] text-left cursor-zoom-in">
                                      <img src={getCleanFileUrl(idea.attachment.url)} alt={idea.attachment.name} className="w-full h-auto object-cover hover:opacity-90 transition-opacity" referrerPolicy="no-referrer" />
                                    </button>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <Paperclip size={14} className="text-[#80868b]" />
                                    <a href={getCleanFileUrl(idea.attachment.url)} target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] dark:text-[#8ab4f8] hover:underline truncate max-w-[200px]">
                                      {idea.attachment.name}
                                    </a>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          
                          <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#f1f3f4] dark:border-[#3c4043]">
                            <div className="flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                  key={star}
                                  onClick={() => updateIdeaRating(idea.id, star)}
                                  className={`transition-colors ${
                                    star <= idea.rating ? 'text-[#fbbc04]' : 'text-[#dadce0] dark:text-[#5f6368] hover:text-[#fde293] dark:hover:text-[#fbbc04]'
                                  }`}
                                >
                                  <Star size={16} fill={star <= idea.rating ? "currentColor" : "none"} />
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5 text-xs text-[#80868b] dark:text-[#9aa0a6]">
                                <Clock size={14} />
                                <span>{formatDate(idea.createdAt)}</span>
                                {isGlobalSearch && searchQuery && (idea.projectId || 'default') !== activeProjectId && (
                                  <>
                                    <span className="mx-1">•</span>
                                    <Folder size={12} />
                                    <span className="truncate max-w-[100px]">
                                      {allProjects.find(p => p.id === (idea.projectId || 'default'))?.name || t[language].inbox}
                                    </span>
                                  </>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button onClick={() => startEdit(idea)} title={t[language].edit} className="text-[#dadce0] dark:text-[#5f6368] hover:text-[#1a73e8] dark:hover:text-[#8ab4f8] transition-colors">
                                  <Edit2 size={16} />
                                </button>
                                <button onClick={() => convertItem(idea)} title={t[language].convert} className="text-[#dadce0] dark:text-[#5f6368] hover:text-[#fbbc04] dark:hover:text-[#fde293] transition-colors">
                                  <RefreshCw size={16} />
                                </button>
                                <button onClick={() => deleteItem(idea.id)} className="text-[#dadce0] dark:text-[#5f6368] hover:text-[#ea4335] dark:hover:text-[#f28b82] transition-colors">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Reorder.Item>
                  ))}
                </AnimatePresence>
                {ideas.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-[#80868b] dark:text-[#9aa0a6] p-8 text-center">
                    <Lightbulb size={48} className="mb-4 opacity-20" />
                    <p>{t[language].emptyIdeas}</p>
                  </div>
                )}
              </Reorder.Group>
            </div>
          )}

        </div>

        {/* Chat Input Area */}
        <div className="p-4 bg-white dark:bg-[#28292c] border-t border-[#dadce0] dark:border-[#3c4043] transition-colors duration-200">
          {attachedFile && (
            <div className="max-w-4xl mx-auto mb-2 flex items-center gap-2 p-2 bg-[#e8f0fe] dark:bg-[#394457] text-[#1a73e8] dark:text-[#8ab4f8] rounded-lg text-sm border border-[#d2e3fc] dark:border-[#1a73e8]/30">
              {attachedFile.type.startsWith('image/') ? (
                <img src={URL.createObjectURL(attachedFile)} alt="preview" className="w-8 h-8 object-cover rounded" />
              ) : (
                <Paperclip size={14} />
              )}
              <span className="truncate max-w-[200px]">{attachedFile.name}</span>
              <button onClick={() => setAttachedFile(null)} className="ml-auto hover:text-[#174ea6] dark:hover:text-[#d2e3fc]"><X size={14}/></button>
            </div>
          )}
          <div className="max-w-4xl mx-auto relative flex items-center">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendMessage();
              }}
              onPaste={(e) => {
                if (e.clipboardData.files && e.clipboardData.files.length > 0) {
                  setAttachedFile(e.clipboardData.files[0]);
                }
              }}
              placeholder={t[language].inputPlaceholder}
              className="w-full pl-4 pr-32 py-4 bg-[#f1f3f4] dark:bg-[#202124] border-transparent rounded-full text-[#202124] dark:text-[#e8eaed] placeholder-[#80868b] dark:placeholder-[#9aa0a6] focus:bg-white dark:focus:bg-[#28292c] focus:border-[#1a73e8] dark:focus:border-[#8ab4f8] focus:ring-4 focus:ring-[#1a73e8]/20 dark:focus:ring-[#8ab4f8]/20 transition-all shadow-sm"
              disabled={isProcessing}
            />
            
            <div className="absolute right-2 flex items-center gap-1">
              <label title={t[language].attachFile} className="p-2 text-[#80868b] hover:text-[#1a73e8] dark:hover:text-[#8ab4f8] cursor-pointer transition-colors">
                <Paperclip size={18} />
                <input type="file" className="hidden" onChange={handleFileUpload} />
              </label>
              <button
                onClick={() => setIsAiEnabled(!isAiEnabled)}
                title={t[language].aiToggle}
                className={`p-2 rounded-full transition-colors ${isAiEnabled ? 'text-[#1a73e8] bg-[#e8f0fe] dark:bg-[#394457] dark:text-[#8ab4f8]' : 'text-[#80868b] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043]'}`}
              >
                <Sparkles size={18} />
              </button>
              <button
                onClick={handleSendMessage}
                disabled={(!inputValue.trim() && !attachedFile) || isProcessing}
                className="p-2 ml-1 bg-[#1a73e8] hover:bg-[#174ea6] disabled:bg-[#dadce0] dark:disabled:bg-[#3c4043] text-white dark:disabled:text-[#5f6368] rounded-full flex items-center justify-center transition-colors shadow-sm"
              >
                {isProcessing ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                    <Circle className="opacity-50" size={18} />
                  </motion.div>
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>
          </div>
          <p className="text-center text-xs text-[#80868b] dark:text-[#9aa0a6] mt-3">
            {t[language].footer}
          </p>
        </div>
      </div>

      {/* Image Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button 
            className="absolute top-4 right-4 text-white hover:text-[#dadce0] p-2 bg-black/50 rounded-full transition-colors"
            onClick={() => setPreviewImage(null)}
          >
            <X size={24} />
          </button>
          <img 
            src={previewImage} 
            alt="Preview" 
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}
    </div>
  );
}
