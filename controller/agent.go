package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetAgentOverview 代理概览（下级用户数、累计佣金、可提现余额）
func GetAgentOverview(c *gin.Context) {
	userId := c.GetInt("id")
	var user model.User
	if err := model.DB.Select("id, commission_balance, agent_level").First(&user, userId).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "用户不存在"})
		return
	}
	if user.AgentLevel == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "您不是代理用户"})
		return
	}
	var subCount int64
	model.DB.Model(&model.User{}).Where("agent_parent_id = ?", userId).Count(&subCount)

	var totalCommission struct{ Total int64 }
	model.DB.Model(&model.Commission{}).Select("COALESCE(SUM(amount), 0) as total").Where("agent_id = ?", userId).Scan(&totalCommission)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"sub_user_count":      subCount,
			"total_commission":    totalCommission.Total,
			"commission_balance":  user.CommissionBalance,
			"agent_level":         user.AgentLevel,
		},
	})
}

// GetAgentSubUsers 下级用户列表
func GetAgentSubUsers(c *gin.Context) {
	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil || user.AgentLevel == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无权限"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize > 100 {
		pageSize = 100
	}
	users, total, err := model.GetAgentSubUsers(userId, page, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": users, "total": total})
}

// GetAgentCommissions 佣金明细
func GetAgentCommissions(c *gin.Context) {
	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil || user.AgentLevel == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无权限"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize > 100 {
		pageSize = 100
	}
	commissions, total, err := model.GetCommissionsByAgentId(userId, page, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": commissions, "total": total})
}

// WithdrawCommission 佣金提现到账户余额
func WithdrawCommission(c *gin.Context) {
	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil || user.AgentLevel == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无权限"})
		return
	}
	if user.CommissionBalance <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "可提现余额为零"})
		return
	}
	amount := user.CommissionBalance
	tx := model.DB.Begin()
	if err := tx.Model(&model.User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"commission_balance": 0,
	}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "提现失败"})
		return
	}
	if err := tx.Model(&model.User{}).Where("id = ?", userId).UpdateColumn("quota", gorm.Expr("quota + ?", amount)).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "提现失败"})
		return
	}
	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "提现成功", "amount": amount})
}

// AdminSetAgentLevel 管理员设置用户代理等级和佣金比例
func AdminSetAgentLevel(c *gin.Context) {
	idStr := c.Param("id")
	targetId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户 ID"})
		return
	}
	var req struct {
		AgentLevel       int     `json:"agent_level"`
		AgentParentId    int     `json:"agent_parent_id"`
		CommissionRate   float64 `json:"commission_rate"`
		L2CommissionRate float64 `json:"l2_commission_rate"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	updates := map[string]interface{}{
		"agent_level":        req.AgentLevel,
		"agent_parent_id":    req.AgentParentId,
		"commission_rate":    req.CommissionRate,
		"l2_commission_rate": req.L2CommissionRate,
	}
	if err := model.DB.Model(&model.User{}).Where("id = ?", targetId).Updates(updates).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "设置成功"})
}
