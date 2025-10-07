import React, { useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Space, Dropdown, Checkbox } from 'antd';
import { UserOutlined, LockOutlined, GlobalOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

const Login: React.FC = () => {
  const { login, loginLoading } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm();

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  // 组件加载时从localStorage读取保存的账号密码
  useEffect(() => {
    const savedCredentials = localStorage.getItem('electron_saved_credentials');
    if (savedCredentials) {
      try {
        const { username, password, remember } = JSON.parse(savedCredentials);
        if (remember) {
          form.setFieldsValue({
            username,
            password,
            remember: true
          });
        }
      } catch (error) {
        console.error('Failed to parse saved credentials:', error);
      }
    }
  }, [form]);

  const onLogin = async (values: { username: string; password: string; remember?: boolean }) => {
    const { username, password, remember } = values;

    // 处理记住密码
    if (remember) {
      localStorage.setItem('electron_saved_credentials', JSON.stringify({
        username,
        password,
        remember: true
      }));
    } else {
      localStorage.removeItem('electron_saved_credentials');
    }

    const success = await login({ username, password });
    if (success) {
      navigate('/dashboard');
    }
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}>
      <Card
        style={{
          width: 400,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          borderRadius: 12,
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, right: 0 }}>
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
              >
                <Button icon={<GlobalOutlined />} size="small">
                  {i18n.language === 'zh-CN' ? '中文' : 'English'}
                </Button>
              </Dropdown>
            </div>
            <Title level={2} style={{ margin: 0, color: '#1890ff' }}>
              {t('header.title')}
            </Title>
            <Text type="secondary">{t('auth.subtitle')}</Text>
          </div>

          <Form
            name="login"
            form={form}
            onFinish={onLogin}
            autoComplete="off"
            layout="vertical"
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: t('auth.pleaseEnterUsername') }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder={t('auth.username')}
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: t('auth.pleaseEnterPassword') }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder={t('auth.password')}
                size="large"
              />
            </Form.Item>

            <Form.Item name="remember" valuePropName="checked">
              <Checkbox>{t('auth.rememberPassword')}</Checkbox>
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loginLoading}
                size="large"
                block
              >
                {t('auth.login')}
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  );
};

export default Login;
