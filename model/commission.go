package model

import "gorm.io/gorm"

type Commission struct {
	Id           int            `json:"id" gorm:"primaryKey;autoIncrement"`
	AgentId      int            `json:"agent_id" gorm:"type:int;index;not null"`
	FromUserId   int            `json:"from_user_id" gorm:"type:int;index;not null"`
	Amount       int64          `json:"amount" gorm:"type:bigint;not null"`        // 佣金额度
	OriginalCost int64          `json:"original_cost" gorm:"type:bigint;not null"` // 原始消费额
	Level        int            `json:"level" gorm:"type:int;default:1"`           // 1:直推佣金 2:二级佣金
	CreatedAt    int64          `json:"created_at" gorm:"type:bigint;autoCreateTime"`
	DeletedAt    gorm.DeletedAt `gorm:"index"`
}

func GetCommissionsByAgentId(agentId int, page, pageSize int) ([]*Commission, int64, error) {
	var commissions []*Commission
	var total int64
	offset := (page - 1) * pageSize
	result := DB.Model(&Commission{}).Where("agent_id = ?", agentId).Count(&total)
	if result.Error != nil {
		return nil, 0, result.Error
	}
	result = DB.Where("agent_id = ?", agentId).Order("created_at desc").Offset(offset).Limit(pageSize).Find(&commissions)
	return commissions, total, result.Error
}

func GetAgentSubUsers(agentId int, page, pageSize int) ([]*User, int64, error) {
	var users []*User
	var total int64
	offset := (page - 1) * pageSize
	result := DB.Model(&User{}).Where("agent_parent_id = ?", agentId).Count(&total)
	if result.Error != nil {
		return nil, 0, result.Error
	}
	result = DB.Where("agent_parent_id = ?", agentId).
		Select("id, username, display_name, email, quota, used_quota, created_at, status").
		Offset(offset).Limit(pageSize).Find(&users)
	return users, total, result.Error
}

// GrantCommission 在用户消费后向上级代理发放佣金（2级）
func GrantCommission(userId int, cost int64) {
	if cost <= 0 {
		return
	}
	var user User
	if err := DB.Select("agent_parent_id").First(&user, userId).Error; err != nil {
		return
	}
	if user.AgentParentId == 0 {
		return
	}

	// 一级代理佣金
	var agent User
	if err := DB.Select("id, commission_rate, agent_parent_id, commission_balance").First(&agent, user.AgentParentId).Error; err != nil {
		return
	}
	l1Amount := int64(float64(cost) * agent.CommissionRate)
	if l1Amount > 0 {
		DB.Model(&User{}).Where("id = ?", agent.Id).UpdateColumn("commission_balance", gorm.Expr("commission_balance + ?", l1Amount))
		DB.Create(&Commission{AgentId: agent.Id, FromUserId: userId, Amount: l1Amount, OriginalCost: cost, Level: 1})
	}

	// 二级代理佣金
	if agent.AgentParentId == 0 {
		return
	}
	var superAgent User
	if err := DB.Select("id, l2_commission_rate, commission_balance").First(&superAgent, agent.AgentParentId).Error; err != nil {
		return
	}
	l2Amount := int64(float64(cost) * superAgent.L2CommissionRate)
	if l2Amount > 0 {
		DB.Model(&User{}).Where("id = ?", superAgent.Id).UpdateColumn("commission_balance", gorm.Expr("commission_balance + ?", l2Amount))
		DB.Create(&Commission{AgentId: superAgent.Id, FromUserId: userId, Amount: l2Amount, OriginalCost: cost, Level: 2})
	}
}
