import React, { useState, useEffect } from 'react';
import {
  Layout,
  Card,
  Button,
  List,
  Avatar,
  Tag,
  Space,
  Typography,
  Modal,
  Form,
  Input,
  Select,
  message,
  Dropdown,
  Tooltip,
  Tabs,
} from 'antd';
import {
  PlusOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  UserOutlined,
  LogoutOutlined,
  CodeOutlined,
  ShareAltOutlined,
  LoginOutlined,
  DeleteOutlined,
  ReloadOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  CrownOutlined,
  GlobalOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { roomsAPI } from '../services/api';
import socketService from '../services/socket';
import { useTranslation } from 'react-i18next';

const { Header, Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

interface Room {
  id: string;
  name: string;
  description: string;
  roomCode: string;
  password?: string;
  status: 'normal' | 'ended';
  language: string;
  createdAt: string;
  onlineCount?: number; // 实时在线人数
  members: Array<{
    id: string;
    role: string;
    isOnline: boolean;
    user: {
      id: string;
      username: string;
    };
  }>;
}

const Dashboard: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [myCreatedRooms, setMyCreatedRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [myRoomsLoading, setMyRoomsLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('active-rooms');
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [joinForm] = Form.useForm();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    loadRooms();

    // 连接Socket并监听房间更新
    socketService.connect();
    socketService.onRoomUpdated((data) => {
      // 更新房间列表中对应房间的在线人数
      setRooms(prevRooms =>
        prevRooms.map(room =>
          room.id === data.roomId
            ? { ...room, onlineCount: data.onlineCount }
            : room
        )
      );

    });

    return () => {
      socketService.off('room-updated');
    };
  }, []);

  const loadRooms = async () => {
    try {
      setLoading(true);
      const response = await roomsAPI.getMyRooms();
      setRooms(response.data);
    } catch (error) {
      message.error(t('dashboard.loadRoomsFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadMyCreatedRooms = async () => {
    try {
      setMyRoomsLoading(true);
      const response = await roomsAPI.getMyRooms('created');
      setMyCreatedRooms(response.data);
    } catch (error) {
      message.error(t('dashboard.loadRoomsFailed'));
    } finally {
      setMyRoomsLoading(false);
    }
  };


  const handleCreateRoom = async (values: any) => {
    try {
      await roomsAPI.createRoom(values);
      message.success(t('dashboard.createRoomSuccess'));
      setCreateModalVisible(false);
      form.resetFields();
      refreshCurrentTab();
    } catch (error) {
      message.error(t('dashboard.createRoomFailed'));
    }
  };

  const handleJoinRoom = async (roomId: string) => {
    try {
      // First join the room via API
      await roomsAPI.joinRoom(roomId);
      message.success(t('dashboard.joinRoomSuccess'));
      // Then navigate to the room
      navigate(`/room/${roomId}`);
    } catch (error: any) {
      if (error.response?.status === 403 && error.response?.data?.message?.includes('already a member')) {
        // User is already a member, just navigate
        navigate(`/room/${roomId}`);
      } else if (error.response?.status === 404) {
        // Room has been deleted
        message.error(t('room.roomNotFound'));
        // Refresh the current room list to remove deleted rooms
        refreshCurrentTab();
      } else {
        message.error(t('dashboard.joinRoomFailed'));
        console.error('Join room error:', error);
      }
    }
  };

  const handleJoinByCode = async (values: any) => {
    try {
      await roomsAPI.joinRoomByCode(values.roomCode, values.password);
      message.success(t('room.alreadyJoined'));
      setJoinModalVisible(false);
      joinForm.resetFields();
      // Navigate to the room
      const roomResponse = await roomsAPI.getRoomByCode(values.roomCode);
      navigate(`/room/${roomResponse.data.id}`);
      refreshCurrentTab(); // Refresh room list
    } catch (error: any) {
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else {
        message.error(t('dashboard.joinRoomFailed'));
      }
    }
  };

  const copyRoomCode = (roomCode: string) => {
    navigator.clipboard.writeText(roomCode);
    message.success(t('room.roomCodeCopied'));
  };

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  // 处理离开房间（非创建者删除房间）
  const handleLeaveRoom = async (roomId: string, roomName: string) => {
    Modal.confirm({
      title: t('room.leaveRoom'),
      content: t('dashboard.confirmLeaveRoom', { roomName }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await roomsAPI.leaveRoom(roomId);
          message.success(t('dashboard.leaveRoomSuccess'));
          refreshCurrentTab();
          if (activeTab === 'my-rooms') {
            loadMyCreatedRooms();
          }
        } catch (error: any) {
          message.error(t('dashboard.leaveRoomFailed'));
        }
      }
    });
  };

  const togglePasswordVisibility = (roomId: string) => {
    setVisiblePasswords(prev => {
      const newSet = new Set(prev);
      if (newSet.has(roomId)) {
        newSet.delete(roomId);
      } else {
        newSet.add(roomId);
      }
      return newSet;
    });
  };


  const refreshCurrentTab = () => {
    switch (activeTab) {
      case 'active-rooms':
        loadRooms();
        break;
      case 'my-rooms':
        loadMyCreatedRooms();
        break;
    }
  };

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    try {
      // 首先检查房间是否有在线用户
      const roomResponse = await roomsAPI.getRoom(roomId);
      const onlineMembers = roomResponse.data.members.filter(m => m.isOnline);
      const otherOnlineMembers = onlineMembers.filter(m => m.user.id !== user?.id);

      let confirmContent = t('room.deleteRoomConfirm', { roomName });

      if (otherOnlineMembers.length > 0) {
        const userNames = otherOnlineMembers.map((m: any) => m.user.username).join(', ');
        confirmContent = t('room.deleteRoomWithUsers', { count: otherOnlineMembers.length, users: userNames });
      }

      Modal.confirm({
        title: t('room.deleteRoom'),
        content: confirmContent,
        okText: t('common.confirm'),
        okType: 'danger',
        cancelText: t('common.cancel'),
        onOk: async () => {
          try {
            const deleteResponse = await roomsAPI.deleteRoom(roomId);

            // 如果有在线用户被强制退出，显示通知
            if (deleteResponse.data?.onlineMembers?.length > 0) {
              const affectedUsers = deleteResponse.data.onlineMembers.map((u: any) => u.username).join(', ');
              message.success(t('room.roomDeleteSuccessWithUsers', { count: deleteResponse.data.onlineMembers.length, users: affectedUsers }));
            } else {
              message.success(t('room.roomDeleteSuccess'));
            }

            refreshCurrentTab(); // 重新加载房间列表
          } catch (error: any) {
            if (error.response?.data?.message) {
              message.error(error.response.data.message);
            } else {
              message.error(t('dashboard.deleteRoomFailed'));
            }
          }
        },
      });
    } catch (error: any) {
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else {
        message.error(t('dashboard.loadRoomsFailed'));
      }
    }
  };

  const handleEndRoom = async (roomId: string, _roomName: string) => {
    Modal.confirm({
      title: t('editor.confirmEndRoom'),
      content: t('editor.endRoomWarning'),
      okText: t('editor.confirmEnd'),
      cancelText: t('common.cancel'),
      okType: 'danger',
      onOk: async () => {
        try {
          await roomsAPI.endRoom(roomId);
          message.success(t('editor.roomEndSuccess'));
          refreshCurrentTab(); // 重新加载房间列表
        } catch (error: any) {
          if (error.response?.data?.message) {
            message.error(error.response.data.message);
          } else {
            message.error(t('editor.endRoomFailed'));
          }
        }
      }
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'normal':
        return 'green';
      case 'ended':
        return 'red';
      default:
        return 'default';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'normal':
        return t('room.statusNormal');
      case 'ended':
        return t('room.statusEnded');
      default:
        return status;
    }
  };

  const userMenuItems = [

    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('auth.logout'),
      onClick: logout,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        background: '#fff',
        padding: '0 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}>
        <Title level={3} style={{ margin: 0, color: '#1890ff' }}>
          {t('header.title')}
        </Title>
        <Space>
          <Text>{t('header.welcome')}, {user?.username}</Text>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'zh-CN',
                  label: t('settings.chinese'),
                  onClick: () => changeLanguage('zh-CN'),
                },
                {
                  key: 'en-US',
                  label: t('settings.english'),
                  onClick: () => changeLanguage('en-US'),
                },
              ]
            }}
            placement="bottomRight"
          >
            <Button
              icon={<GlobalOutlined />}
              size="small"
              style={{ marginRight: 8 }}
            >
              {i18n.language === 'zh-CN' ? '中文' : 'English'}
            </Button>
          </Dropdown>
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Avatar
              style={{ backgroundColor: '#1890ff', cursor: 'pointer' }}
              icon={<UserOutlined />}
            />
          </Dropdown>
        </Space>
      </Header>

      <Content style={{
        padding: '24px',
        height: 'calc(100vh - 64px)',
        overflow: 'auto'
      }}>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={2} style={{ margin: 0 }}>{t('dashboard.title')}</Title>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={refreshCurrentTab}
              title={t('common.refresh')}
              size="small"
            >
              {t('common.refresh')}
            </Button>
            <Button
              icon={<LoginOutlined />}
              onClick={() => setJoinModalVisible(true)}
              size="small"
            >
              {t('room.joinRoom')}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
              size="small"
            >
              {t('room.createRoom')}
            </Button>
          </Space>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key);
            if (key === 'my-rooms' && myCreatedRooms.length === 0) {
              loadMyCreatedRooms();
            }
          }}
          items={[
            {
              key: 'active-rooms',
              label: t('room.activeRooms'),
              children: (

        <List
          grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }}
          dataSource={rooms}
          loading={loading}
          renderItem={(room) => {
            const userMember = room.members.find(m => m.user.id === user?.id);
            const isCreator = userMember?.role === 'admin';

            return (
              <List.Item>
                <Card
                  hoverable
                  style={{
                    height: '200px',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                  styles={{
                    body: {
                      padding: '8px',
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden'
                    },
                    actions: {
                      padding: '8px 4px',
                      display: 'flex',
                      justifyContent: 'space-around',
                      gap: '8px'
                    }
                  }}
                  actions={[
                    <Tooltip title={room.status === 'ended' ? t('room.cannotEnterEndedRoom') : t('room.enterRoom')}>
                      <Button
                        type="primary"
                        icon={<CodeOutlined />}
                        onClick={() => handleJoinRoom(room.id)}
                        size="small"
                        disabled={room.status === 'ended'}
                      >
                        {t('common.enter')}
                      </Button>
                    </Tooltip>,
                    <Tooltip title={room.status === 'ended' ? t('room.cannotShareEndedRoom') : t('room.shareRoom')}>
                      <Button
                        icon={<ShareAltOutlined />}
                        onClick={() => copyRoomCode(room.roomCode)}
                        size="small"
                        disabled={room.status === 'ended'}
                      >
                        {t('common.share')}
                      </Button>
                    </Tooltip>,
                    isCreator ? (
                      <Tooltip title={t('room.deleteRoom')}>
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeleteRoom(room.id, room.name)}
                          size="small"
                        >
                          {t('common.delete')}
                        </Button>
                      </Tooltip>
                    ) : (
                      <Tooltip title={t('room.leaveRoom')}>
                        <Button
                          danger
                          icon={<LogoutOutlined />}
                          onClick={() => handleLeaveRoom(room.id, room.name)}
                          size="small"
                        >
                          {t('common.exit')}
                        </Button>
                      </Tooltip>
                    ),
                  ].filter(Boolean)}
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* 头部：状态图标 + 标题 + 房间号 */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div style={{ marginRight: '6px', marginTop: '1px' }}>
                        {room.status === 'normal' ? (
                          <PlayCircleOutlined style={{ fontSize: 16, color: '#52c41a' }} />
                        ) : (
                          <PauseCircleOutlined style={{ fontSize: 16, color: '#ff4d4f' }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                          <Text strong style={{
                            fontSize: '13px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            lineHeight: '1.2'
                          }}>
                            {room.name}
                          </Text>
                          <Tooltip title="点击复制房间号">
                            <Tag
                              color="purple"
                              style={{
                                margin: 0,
                                fontSize: '9px',
                                cursor: 'pointer',
                                fontFamily: 'monospace',
                                padding: '1px 4px',
                                lineHeight: '1.2'
                              }}
                              onClick={() => copyRoomCode(room.roomCode)}
                            >
                              {room.roomCode}
                            </Tag>
                          </Tooltip>
                        </div>
                        {/* 创建者标识 */}
                        {isCreator && (
                          <Tag color="gold" icon={<CrownOutlined />} style={{
                            margin: 0,
                            fontSize: '9px',
                            padding: '1px 4px',
                            lineHeight: '1.2'
                          }}>
                            {t('room.creator')}
                          </Tag>
                        )}
                      </div>
                    </div>

                    {/* 描述 */}
                    <div style={{
                      flex: 1,
                      overflow: 'hidden',
                      marginBottom: '8px'
                    }}>
                      <Text
                        type="secondary"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          fontSize: '11px',
                          lineHeight: '1.3',
                          wordBreak: 'break-word'
                        }}
                      >
                        {room.description || t('room.noDescription')}
                      </Text>
                    </div>

                    {/* 标签区域 */}
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '3px',
                      alignItems: 'center',
                      marginBottom: '6px',
                      minHeight: '18px'
                    }}>
                      {room.password && (
                        <Tooltip title={visiblePasswords.has(room.id) ? t('room.passwordVisible') : t('room.passwordHidden')}>
                          <Tag
                            color="orange"
                            icon={visiblePasswords.has(room.id) ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                            style={{
                              margin: 0,
                              fontSize: '9px',
                              cursor: 'pointer',
                              padding: '1px 4px',
                              lineHeight: '1.2'
                            }}
                            onClick={() => togglePasswordVisibility(room.id)}
                          >
                            {visiblePasswords.has(room.id) ? room.password : t('room.roomPassword')}
                          </Tag>
                        </Tooltip>
                      )}
                      <Tag color={getStatusColor(room.status)} style={{
                        margin: 0,
                        fontSize: '9px',
                        padding: '1px 4px',
                        lineHeight: '1.2'
                      }}>
                        {getStatusText(room.status)}
                      </Tag>
                      <Tag color="blue" style={{
                        margin: 0,
                        fontSize: '9px',
                        padding: '1px 4px',
                        lineHeight: '1.2'
                      }}>
                        {room.language}
                      </Tag>
                    </div>

                    {/* 底部信息 */}
                    <div style={{ marginTop: 'auto' }}>
                      <Text type="secondary" style={{ fontSize: '10px', lineHeight: '1.2' }}>
                        {t('room.onlineUsers')}: {room.onlineCount !== undefined ? room.onlineCount : room.members.filter((m: any) => m.isOnline).length}
                      </Text>
                    </div>
                  </div>
                </Card>
              </List.Item>
            );
          }}
        />
              ),
            },
            {
              key: 'my-rooms',
              label: t('room.myRooms'),
              children: (
                <List
                  grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }}
                  dataSource={myCreatedRooms}
                  loading={myRoomsLoading}
                  renderItem={(room) => {
                    return (
                      <List.Item>
                        <Card
                          hoverable
                          style={{
                            height: '200px',
                            display: 'flex',
                            flexDirection: 'column'
                          }}
                          styles={{
                            body: {
                              padding: '8px',
                              flex: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              overflow: 'hidden'
                            },
                            actions: {
                              padding: '8px 4px',
                              display: 'flex',
                              justifyContent: 'space-around',
                              gap: '4px'
                            }
                          }}
                          actions={[
                            <Tooltip title={room.status === 'ended' ? t('room.cannotEnterEndedRoom') : t('room.enterRoom')}>
                              <Button
                                type="primary"
                                icon={<CodeOutlined />}
                                onClick={() => handleJoinRoom(room.id)}
                                size="small"
                                disabled={room.status === 'ended'}
                              >
                                {t('common.enter')}
                              </Button>
                            </Tooltip>,
                            <Tooltip title={room.status === 'ended' ? t('room.cannotShareEndedRoom') : t('room.shareRoom')}>
                              <Button
                                icon={<ShareAltOutlined />}
                                onClick={() => copyRoomCode(room.roomCode)}
                                size="small"
                                disabled={room.status === 'ended'}
                              >
                                {t('common.share')}
                              </Button>
                            </Tooltip>,
                            <Tooltip title={t('room.deleteRoom')}>
                              <Button
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => handleDeleteRoom(room.id, room.name)}
                                size="small"
                              >
                                {t('common.delete')}
                              </Button>
                            </Tooltip>,
                          ]}
                        >
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {/* 头部：状态图标 + 标题 + 房间号 */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '6px' }}>
                              <div style={{ marginRight: '6px', marginTop: '1px' }}>
                                {room.status === 'normal' ? (
                                  <PlayCircleOutlined style={{ fontSize: 16, color: '#52c41a' }} />
                                ) : (
                                  <PauseCircleOutlined style={{ fontSize: 16, color: '#ff4d4f' }} />
                                )}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                  <Text strong style={{
                                    fontSize: '13px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    flex: 1,
                                    lineHeight: '1.2'
                                  }}>
                                    {room.name}
                                  </Text>
                                  {room.status === 'normal' && (
                                    <Tooltip title={t('room.endRoom')}>
                                      <Button
                                        danger
                                        size="small"
                                        icon={<StopOutlined />}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleEndRoom(room.id, room.name);
                                        }}
                                        style={{
                                          fontSize: '10px',
                                          height: '20px',
                                          minWidth: 'auto',
                                          padding: '0 6px',
                                          lineHeight: '1'
                                        }}
                                      >
                                        {t('room.endRoom')}
                                      </Button>
                                    </Tooltip>
                                  )}
                                  <Tooltip title="点击复制房间号">
                                    <Tag
                                      color="purple"
                                      style={{
                                        margin: 0,
                                        fontSize: '9px',
                                        cursor: 'pointer',
                                        fontFamily: 'monospace',
                                        padding: '1px 4px',
                                        lineHeight: '1.2'
                                      }}
                                      onClick={() => copyRoomCode(room.roomCode)}
                                    >
                                      {room.roomCode}
                                    </Tag>
                                  </Tooltip>
                                </div>
                                {/* 创建者标识 */}
                                <Tag color="gold" icon={<CrownOutlined />} style={{
                                  margin: 0,
                                  fontSize: '9px',
                                  padding: '1px 4px',
                                  lineHeight: '1.2'
                                }}>
                                  {t('room.creator')}
                                </Tag>
                              </div>
                            </div>

                            {/* 描述 */}
                            <div style={{
                              flex: 1,
                              overflow: 'hidden',
                              marginBottom: '8px'
                            }}>
                              <Text
                                type="secondary"
                                style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  fontSize: '11px',
                                  lineHeight: '1.3',
                                  wordBreak: 'break-word'
                                }}
                              >
                                {room.description || t('room.noDescription')}
                              </Text>
                            </div>

                            {/* 标签区域 */}
                            <div style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '3px',
                              alignItems: 'center',
                              marginBottom: '6px',
                              minHeight: '18px'
                            }}>
                              {room.password && (
                                <Tooltip title={visiblePasswords.has(room.id) ? t('room.passwordVisible') : t('room.passwordHidden')}>
                                  <Tag
                                    color="orange"
                                    icon={visiblePasswords.has(room.id) ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                    style={{
                                      margin: 0,
                                      fontSize: '9px',
                                      cursor: 'pointer',
                                      padding: '1px 4px',
                                      lineHeight: '1.2'
                                    }}
                                    onClick={() => togglePasswordVisibility(room.id)}
                                  >
                                    {visiblePasswords.has(room.id) ? room.password : t('room.roomPassword')}
                                  </Tag>
                                </Tooltip>
                              )}
                              <Tag color={getStatusColor(room.status)} style={{
                                margin: 0,
                                fontSize: '9px',
                                padding: '1px 4px',
                                lineHeight: '1.2'
                              }}>
                                {getStatusText(room.status)}
                              </Tag>
                              <Tag color="blue" style={{
                                margin: 0,
                                fontSize: '9px',
                                padding: '1px 4px',
                                lineHeight: '1.2'
                              }}>
                                {room.language}
                              </Tag>
                            </div>

                            {/* 底部信息 */}
                            <div style={{ marginTop: 'auto' }}>
                              <Text type="secondary" style={{ fontSize: '10px', lineHeight: '1.2' }}>
                                {t('room.onlineUsers')}: {room.onlineCount !== undefined ? room.onlineCount : room.members.filter((m: any) => m.isOnline).length}
                              </Text>
                            </div>
                          </div>
                        </Card>
                      </List.Item>
                    );
                  }}
                />
              ),
            },
           
          ]}
        />

        <Modal
          title={t('room.createRoom')}
          open={createModalVisible}
          onCancel={() => {
            setCreateModalVisible(false);
            form.resetFields();
          }}
          footer={null}
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={handleCreateRoom}
          >
            <Form.Item
              name="name"
              label={t('room.roomName')}
              rules={[{ required: true, message: t('room.roomName') }]}
            >
              <Input placeholder={t('room.roomName')} />
            </Form.Item>

            <Form.Item
              name="description"
              label={t('room.roomDescription')}
            >
              <Input.TextArea placeholder={t('room.roomDescription')} rows={3} />
            </Form.Item>

            <Form.Item
              name="password"
              label={t('room.roomPassword')}
            >
              <Input.Password placeholder={t('room.roomPassword')} />
            </Form.Item>

            <Form.Item
              name="language"
              label={t('editor.language')}
              initialValue="javascript"
            >
              <Select>
                <Option value="javascript">JavaScript</Option>
                <Option value="typescript">TypeScript</Option>
                <Option value="python">Python</Option>
                <Option value="java">Java</Option>
                <Option value="cpp">C++</Option>
                <Option value="csharp">C#</Option>
                <Option value="go">Go</Option>
                <Option value="rust">Rust</Option>
              </Select>
            </Form.Item>

            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  {t('common.create')}
                </Button>
                <Button onClick={() => {
                  setCreateModalVisible(false);
                  form.resetFields();
                }}>
                  {t('common.cancel')}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title={t('room.joinRoom')}
          open={joinModalVisible}
          onCancel={() => {
            setJoinModalVisible(false);
            joinForm.resetFields();
          }}
          footer={null}
        >
          <Form
            form={joinForm}
            layout="vertical"
            onFinish={handleJoinByCode}
          >
            <Form.Item
              name="roomCode"
              label={t('room.roomCode')}
              rules={[{ required: true, message: t('room.roomCode') }]}
            >
              <Input placeholder={t('room.roomCode')} maxLength={6} />
            </Form.Item>

            <Form.Item
              name="password"
              label={t('room.roomPassword')}
            >
              <Input.Password placeholder={t('room.roomPassword')} />
            </Form.Item>

            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  {t('room.joinRoom')}
                </Button>
                <Button onClick={() => {
                  setJoinModalVisible(false);
                  joinForm.resetFields();
                }}>
                  {t('common.cancel')}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  );
};

export default Dashboard;
